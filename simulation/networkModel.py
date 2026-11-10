import random

class SensorNetwork:
    def __init__(self, span, radioRange=14.0, topology='relay', seed=42, loss=0.0, delayMs=100.0, deadlineMs=500.0):
        self.positions = [0.0, span / 4, span / 2, span * 3 / 4]
        self.radioRange = radioRange
        self.topology = topology
        self.rng = random.Random(seed)
        self.loss = loss
        self.delayMs = delayMs
        self.deadlineMs = deadlineMs

    def transmit(self, station, disabled=0):
        path = [station]
        current = station
        reason = 'Delivered'
        if station == disabled:
            return {'path': path, 'delivered': False, 'delayMs': 0, 'reason': 'Source offline'}
        while current != 0:
            target = 0
            if self.positions[current] > self.radioRange:
                if self.topology == 'direct':
                    reason = 'Gateway outside range'
                    break
                target = current - 1
            distance = abs(self.positions[current] - self.positions[target])
            if distance > self.radioRange:
                reason = 'Next hop outside range'
                break
            if target == disabled and target != 0:
                reason = 'Relay offline'
                break
            if self.rng.random() < self.loss:
                reason = 'Packet lost on link'
                break
            path.append(target)
            current = target
        delay = (len(path) - 1) * self.delayMs
        delivered = current == 0
        if delivered and delay > self.deadlineMs:
            delivered = False
            reason = 'Gateway deadline exceeded'
        return {'path': path, 'delivered': delivered, 'delayMs': delay, 'reason': reason}