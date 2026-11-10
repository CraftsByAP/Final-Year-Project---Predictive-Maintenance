# Final Year Project : Predictive Maintenance
# InfraSight

InfraSight is my ITP700 final-year project for the BSc in Information Technology at Richfield. I built it to explore how bridge sensor readings could help a maintenance team spot unusual behaviour, review changes over time and decide what to inspect.

The project uses simulated data from three bridge configurations with spans of 20, 34 and 48 metres. It tracks deflection, crack width, strain and temperature difference. The readings and thresholds are for demonstration purposes. They have not been validated for use on real bridges.

## What the system does

- Displays recent and historical readings for each bridge.
- Flags unusual patterns with an Isolation Forest model. A separate trend calculation estimates when a reading may reach a demonstration threshold if the data supports an estimate.
- Lets authorised users assign maintenance tasks and track their status.
- Uses password and email code sign-in, with roles and permissions checked by the API.
- Exports readings, anomalies, forecasts and maintenance tasks as CSV reports.
- Creates downloadable backups and checks recovery on a separate copy. An optional Linux job uploads encrypted database snapshots to Google Drive.

## How the parts fit together

A Python worker generates simulated readings and prepares the model inputs. The Bun API validates and saves each frame and its results in SQLite. The React dashboard requests those stored records from the API. The model uses the latest 30 valid frames to calculate its features. Older readings remain in the database.

There are two Gazebo demonstration modes. Traffic mode shows vehicles moving across a bridge while Python calculates illustrative sensor responses. Network mode shows how sensor stations can send reports directly to a gateway or relay them through other stations. Gazebo provides the visual simulation. The project does not measure real structural forces or radio performance.

## Project layout

| Location | Purpose |
| --- | --- |
| `backend/` | Bun API, authentication, SQLite setup, Python worker and model training |
| `frontend/src/` | React dashboard and forms |
| `shared/validation.ts` | Validation rules shared by the browser and API |
| `simulation/` | Gazebo worlds, models and simulation controller |
| `models/` | Trained model, model metadata and evaluation results |
| `cloud-backup/` | Optional encrypted Google Drive backup job |
| `data/` | Local SQLite database, backups and recovery copies generated at runtime |
| `docs/erd/` | Database relationship diagrams |

## Running locally

Use Linux, Bun and Python 3.12. The project was developed on Zorin OS with Bun 1.3.14. Gazebo Sim is only needed for the visual demonstrations. Email sign-in needs an SMTP account with working credentials.

### First-time setup

From the project root, install the JavaScript dependencies in both folders and create the Python environment:

```bash
(cd frontend && bun install)
cd backend
bun install
python3.12 -m venv .venv
.venv/bin/python -m pip install numpy scikit-learn joblib python-dotenv
```

Use the library versions listed in `models/metadata.json` when loading the saved model. If you train a new model in your own environment, keep its model file, metadata and evaluation together. Use only model files you trust. To train a new model, run `.venv/bin/python trainModel.py` from `backend/` before starting the worker.

If Bun reports that fflate is missing, run `bun add --exact fflate@0.8.3` from `backend/`.

Create a private `backend/.env` file. Replace the example values with your own settings:

```dotenv
PORT=3000
WORKER_SECRET=replace_with_a_random_secret_at_least_32_characters_long
SMTP_HOST=your_smtp_host
SMTP_PORT=465
SMTP_USER=your_smtp_username
SMTP_PASSWORD=your_smtp_password
EMAIL_FROM=your_sender_email
```

The current email sender expects SMTP over TLS on port 465. Keep the environment file out of Git.

For a fresh database only, run the following from `backend/`. Keep the generated account passwords private. In `setEmails.ts`, give at least the super admin an address you can access for sign-in.

```bash
.venv/bin/python db.py
bun run accountSetup.ts
bun run setEmails.ts
bun -e 'import { Database } from "bun:sqlite"; import { initializeAuth } from "./authRoutes"; const db = new Database("../data/PMSB.db"); initializeAuth(db); db.close();'
bun run migrateAccounts.ts
```

If you already have a migrated database, skip those account setup commands and use your existing accounts. After sign-in, use the Accounts screen to manage users.

### Start the application

Run `bun run api.ts` in `backend/`, then open `http://127.0.0.1:3000` in your browser. Sign in with your username, password and the code sent to your email.

To generate readings without Gazebo, open a second terminal in `backend/` and run:

```bash
.venv/bin/python worker.py
```

For the visual demonstrations, stop any separate worker first. From the project root, run `python3 launchInfraSight.py`, choose a simulation mode and bridge, then select the same bridge in the dashboard. The launcher uses your existing Bun and Gazebo setup.

## Model evaluation and testing

The saved Isolation Forest model was trained on normal synthetic runs. Separate validation runs were used to choose the cutoff. On 4,392 synthetic test windows, it achieved 97.84 percent recall, 96.91 percent precision and a 97.38 percent F1 score. The false positive rate was 15.57 percent. See `models/evaluation.json` for the breakdown. These results describe the synthetic test set, not accuracy on physical bridges.

From the project root, run `bun test tests/validation.test.ts` to check the shared input rules. For a quick manual check, try entering an impossible due date, then correct it and save the task. Check that the task appears in the dashboard and that a report can be exported. Some Gazebo network runs have timed out while updating the scene, so confirm each run from its logs before recording it as complete.

## Database and backups

The local database is `data/PMSB.db`. Open it read-only in DB Browser for SQLite to inspect tables such as `frames`, `readings` and `maintenanceTasks`.

- [Monitoring ERD](docs/erd/Monitoring_ERD.png)
- [Accounts and permissions ERD](docs/erd/Accounts_ERD.png)
- [Maintenance ERD](docs/erd/Maintenance_ERD.png)

The Backups screen can create a package containing the database and trained model files. Its recovery check verifies a separate copy without replacing the running database.

The optional Google Drive job in `cloud-backup/` backs up the database only. It uses rclone to encrypt a checked SQLite snapshot before uploading, and a Linux user timer to run on a schedule. It requires a configured Drive remote. Keep model files, source code and private configuration backed up separately.

Keep environment files, live databases, backup archives, rclone configuration and generated simulation logs out of version control. The ERDs document the schema and can be committed with the source.

## Author

Aphiwe Thabethe, BSc Information Technology, Richfield Graduate Institute of Technology. 
