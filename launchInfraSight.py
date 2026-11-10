"""a little presentation launcher...had to do it because I honestly cannot remember all the terminal code ah"""
from datetime import datetime
from pathlib import Path
import argparse
import json
import os
import shutil
import signal
import subprocess
import time
import urllib.error
import urllib.request
import webbrowser


projectFolder = Path(__file__).resolve().parent
dashboardUrl = 'http://127.0.0.1:3000'
apiProcess = None
gazeboProcess = None
controllerProcess = None


def stopProcess(process):
    # Only stops a process group started by this launcher.
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except ProcessLookupError:
        return
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=5)


def apiReady():
    try:
        with urllib.request.urlopen(dashboardUrl + '/api/health', timeout=2) as response:
            result = json.load(response)
        return result.get('status') == 'ok' and result.get('application') == 'PMSB'
    except (OSError, ValueError, urllib.error.URLError):
        return False


def startApi():
    global apiProcess
    if apiReady():
        if apiProcess is None:
            print('The existing InfraSight API is ready. It will be left running when you exit.')
        else:
            print('The API started by this launcher is ready.')
        return
    bunPath = shutil.which('bun')
    if bunPath is None:
        candidate = Path.home() / '.bun' / 'bin' / 'bun'
        if candidate.is_file():
            bunPath = str(candidate)
    if bunPath is None:
        raise RuntimeError('Bun was not found. Use the terminal where bun run api.ts normally works.')
    folder = projectFolder / 'data' / 'launcher'
    folder.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    logPath = folder / ('api-' + timestamp + '.txt')
    print('Starting the existing API. Startup log:', logPath)
    with logPath.open('w', encoding='utf-8') as log:
        apiProcess = subprocess.Popen(
            [bunPath, 'run', 'api.ts'],
            cwd=projectFolder / 'backend',
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True
        )
    for attempt in range(30):
        if apiProcess.poll() is not None:
            raise RuntimeError('API startup failed. Check its log: ' + str(logPath))
        if apiReady():
            print('API and database health check passed.')
            return
        time.sleep(0.5)
    raise RuntimeError('API did not become ready at port 3000. Check its log: ' + str(logPath))


def services():
    result = subprocess.run(
        ['gz', 'service', '-l'], capture_output=True, text=True, timeout=5
    )
    if result.returncode != 0:
        raise RuntimeError('Gazebo service listing failed: ' + result.stderr.strip())
    return result.stdout


def startSimulation(bridge, demo, setting):
    global gazeboProcess, controllerProcess
    simulationFolder = projectFolder / 'simulation'
    pythonPath = projectFolder / 'backend' / '.venv' / 'bin' / 'python'
    if not pythonPath.is_file():
        raise RuntimeError('Expected Python interpreter: ' + str(pythonPath))
    if shutil.which('gz') is None:
        raise RuntimeError('Gazebo command gz was not found.')
    worldPath = simulationFolder / 'worlds' / (bridge + '.sdf')
    modelPath = simulationFolder / 'models' / bridge / 'meshes' / 'bridge.stl'
    if not worldPath.is_file() or not modelPath.is_file():
        raise RuntimeError('The world or bridge mesh is missing for ' + bridge)
    if '/world/' in services():
        raise RuntimeError('A Gazebo world is already running. Close that world first, then choose this simulation again.')

    # Gazebo separates resource folders with colons. Your project path contains one.
    # A separate alias avoids renaming or changing the project.
    alias = Path.home() / 'InfraSightGazeboModels'
    expectedModels = simulationFolder / 'models'
    if alias.is_symlink():
        if alias.resolve() != expectedModels.resolve():
            raise RuntimeError('The existing InfraSightGazeboModels link points elsewhere. It was left unchanged.')
    elif alias.exists():
        raise RuntimeError('InfraSightGazeboModels exists but is not the expected link. It was left unchanged.')
    else:
        alias.symlink_to(expectedModels, target_is_directory=True)
    if ':' in str(alias):
        raise RuntimeError('The Gazebo model alias must not contain a colon.')
    environment = os.environ.copy()
    environment['GZ_SIM_RESOURCE_PATH'] = str(alias)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    logFolder = simulationFolder / 'logs'
    logFolder.mkdir(exist_ok=True)
    stem = bridge + '-' + demo + '-' + stamp
    gazeboLog = logFolder / (stem + '-gazebo.txt')
    terminalLog = logFolder / (stem + '-terminal.txt')
    command = [str(pythonPath), '-u', 'runSim.py', '--sim', demo,
               '--bridge', bridge, '--samples', '40', '--send']
    if demo == 'traffic':
        command.extend(['--scenario', setting])
    else:
        command.extend(['--topology', setting])

    print('\nOpening', bridge, '|', demo, '|', setting)
    print('Forty samples; one Gazebo world at a time. Ctrl+C stops this launcher.')
    try:
        with gazeboLog.open('w', encoding='utf-8') as log:
            gazeboProcess = subprocess.Popen(
                ['gz', 'sim', '-r', '--render-engine', 'ogre', str(worldPath)],
                cwd=simulationFolder, env=environment,
                stdout=log, stderr=subprocess.STDOUT, start_new_session=True
            )
        expectedService = '/world/infrasight_' + bridge + '/set_pose_vector'
        ready = False
        for attempt in range(30):
            if gazeboProcess.poll() is not None:
                raise RuntimeError('Gazebo exited during startup. See: ' + str(gazeboLog))
            if expectedService in services().splitlines():
                ready = True
                break
            time.sleep(1)
        if not ready:
            raise RuntimeError('Gazebo pose service was not ready. See: ' + str(gazeboLog))
        print('World service is available. Starting the existing controller.\n')
        with terminalLog.open('w', encoding='utf-8') as log:
            log.write('Command: ' + ' '.join(command) + '\n\n')
            log.flush()
            controllerProcess = subprocess.Popen(
                command, cwd=simulationFolder, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, text=True, bufsize=1,
                start_new_session=True
            )
            for line in controllerProcess.stdout:
                print(line, end='', flush=True)
                log.write(line)
                log.flush()
            exitCode = controllerProcess.wait()
            log.write('\nController exit code: ' + str(exitCode) + '\n')
        print('\nController exit code:', exitCode)
        print('Terminal evidence:', terminalLog)
        print('Gazebo output:', gazeboLog)
        print('The controller also printed its own station CSV path.')
        print('A timeout remains a failed/interrupted run. The launcher does not retry or hide it.')
        input('\nCapture any screenshots now. Press Enter to close this world and return to the menu: ')
    finally:
        stopProcess(controllerProcess)
        stopProcess(gazeboProcess)
        controllerProcess = None
        gazeboProcess = None


def installShortcut():
    # Adds a local application-menu entry, without modifying the application.
    script = str(projectFolder / 'launchInfraSight.py')
    if '\n' in script or '\r' in script:
        raise RuntimeError('The shortcut path must not contain line breaks.')
    quotedScript = script.replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$')
    entry = ('[Desktop Entry]\nType=Application\nName=InfraSight\n'
             'Comment=Open the InfraSight dashboard and simulation menu\n'
             'Exec=python3 "' + quotedScript + '"\n'
             'Terminal=true\nIcon=applications-engineering\n'
             'Categories=Development;Science;\nStartupNotify=false\n')
    dataHome = os.environ.get('XDG_DATA_HOME')
    if dataHome:
        folder = Path(dataHome) / 'applications'
    else:
        folder = Path.home() / '.local' / 'share' / 'applications'
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / 'infrasight.desktop'
    if path.exists() and path.read_text(encoding='utf-8') != entry:
        raise RuntimeError('A different infrasight.desktop shortcut already exists. It was left unchanged.')
    path.write_text(entry, encoding='utf-8')
    path.chmod(0o755)
    print('Shortcut installed. Search your application menu for InfraSight.')
    print('If it is not visible immediately, use: python3 launchInfraSight.py')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shortcut', action='store_true', help='Install an application-menu shortcut and exit')
    args = parser.parse_args()
    if not (projectFolder / 'backend' / 'api.ts').is_file():
        raise RuntimeError('Place launchInfraSight.py in the project root, beside backend, frontend and simulation.')
    if args.shortcut:
        installShortcut()
        return
    if not (projectFolder / 'simulation' / 'runSim.py').is_file():
        raise RuntimeError('Expected simulation/runSim.py. No existing file was changed.')
    startApi()
    webbrowser.open(dashboardUrl)
    while True:
        print('\nINFRASIGHT')
        print('1. Open dashboard')
        print('2. Traffic simulation')
        print('3. Sensor-network simulation')
        print('4. Exit launcher')
        choice = input('Choose 1–4: ').strip()
        if choice == '4':
            break
        if choice == '1':
            webbrowser.open(dashboardUrl)
            continue
        if choice != '2' and choice != '3':
            print('Enter 1, 2, 3 or 4.')
            continue
        bridgeNumber = input('Bridge 1, 2 or 3: ').strip()
        if bridgeNumber not in ['1', '2', '3']:
            print('Choose a bridge from 1 to 3.')
            continue
        bridge = 'bridge' + bridgeNumber
        if choice == '2':
            demo = 'traffic'
            settingChoice = input('1. Normal traffic   2. Overload   [Enter = normal]: ').strip()
            if settingChoice not in ['', '1', '2']:
                print('Choose 1 or 2.')
                continue
            setting = 'normal'
            if settingChoice == '2':
                setting = 'overload'
        else:
            demo = 'network'
            settingChoice = input('1. Relay   2. Direct   [Enter = relay]: ').strip()
            if settingChoice not in ['', '1', '2']:
                print('Choose 1 or 2.')
                continue
            setting = 'relay'
            if settingChoice == '2':
                setting = 'direct'
        try:
            startApi()
            print('Select', bridge, 'in the dashboard to view this run.')
            startSimulation(bridge, demo, setting)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as error:
            print('\nCould not complete this launch:', error)
            print('The menu remains available. Your original startup commands still work.')


def interrupted(signum, frame):
    raise KeyboardInterrupt


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print('\nClosing InfraSight launcher...')
    except Exception as error:
        print('\nLauncher stopped:', error)
        raise SystemExit(1)
    finally:
        stopProcess(controllerProcess)
        stopProcess(gazeboProcess)
        stopProcess(apiProcess)
