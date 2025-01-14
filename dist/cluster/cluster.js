"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const async_1 = __importDefault(require("async"));
const signal_exit_1 = __importDefault(require("signal-exit"));
const lodash_1 = require("lodash");
const sandbox_1 = require("../host/sandbox");
function remove(array, object) {
    const index = array.indexOf(object);
    if (index > -1) {
        array.splice(index, 1);
    }
}
class Cluster {
    constructor({ workers, ...options } = {}) {
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        this.worker = (task, callback) => {
            this._execute(task, callback);
        };
        this.workerCount = workers ?? 1;
        this.sandboxOptions = options;
        this.start();
    }
    execute({ code, timeout, globals, context, }) {
        return new Promise((resolve, reject) => {
            const item = {
                code,
                timeout,
                globals: globals || {},
                context: context || {},
            };
            if (!this.queue) {
                throw new sandbox_1.HostError('invalid queue');
            }
            this.queue.push(item, resolve);
        });
    }
    shutdown() {
        for (const worker of this.inactiveWorkers) {
            this.clearWorkerTimeout(worker);
            worker.childProcess.removeAllListeners();
            worker.childProcess.kill();
        }
        for (const worker of this.activeWorkers) {
            this.clearWorkerTimeout(worker);
            worker.childProcess.removeAllListeners();
            worker.childProcess.kill();
        }
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        if (this.queue) {
            this.queue.kill();
        }
        this.queue = async_1.default.queue(this.worker, this.workerCount);
    }
    start() {
        this.inactiveWorkers = [];
        this.activeWorkers = [];
        this.queue = async_1.default.queue(this.worker, this.workerCount);
        this.ensureWorkers();
        (0, signal_exit_1.default)((code, signal) => {
            this.shutdown();
        });
    }
    ensureWorkers() {
        const total = this.inactiveWorkers.length + this.activeWorkers.length;
        for (let i = 0; i < this.workerCount - total; ++i) {
            const childProcess = this.forkWorker();
            childProcess.send({ initialize: true, ...this.sandboxOptions });
            this.inactiveWorkers.push({ childProcess });
        }
    }
    forkWorker() {
        return (0, child_process_1.fork)(path_1.default.join(__dirname, 'worker'), [], {
            execArgv: [], gid: this.sandboxOptions.gid, uid: this.sandboxOptions.uid,
        });
    }
    popWorker(callback) {
        this.ensureWorkers();
        if (this.inactiveWorkers.length === 0) {
            setImmediate(() => {
                this.popWorker(callback);
            });
            return;
        }
        const worker = this.inactiveWorkers.shift();
        if (worker == null) {
            throw new sandbox_1.HostError('no inactive worker');
        }
        this.activeWorkers.push(worker);
        if (this.activeWorkers.length + this.inactiveWorkers.length !== this.workerCount) {
            throw new sandbox_1.HostError('invalid worker count');
        }
        callback(worker);
    }
    clearWorkerTimeout(worker) {
        if (worker.executionTimeout) {
            clearTimeout(worker.executionTimeout);
        }
        worker.executionTimeout = null;
    }
    finishWorker(worker) {
        this.clearWorkerTimeout(worker);
        remove(this.activeWorkers, worker);
        this.inactiveWorkers.push(worker);
    }
    removeWorker(worker) {
        this.clearWorkerTimeout(worker);
        worker.childProcess.kill();
        worker.childProcess.removeAllListeners();
        remove(this.activeWorkers, worker);
        remove(this.inactiveWorkers, worker);
        this.ensureWorkers();
    }
    _execute({ code, timeout, globals, context, }, cb) {
        const callback = (0, lodash_1.once)(cb);
        this.popWorker((worker) => {
            worker.childProcess.removeAllListeners();
            worker.childProcess.on('message', (message) => {
                this.finishWorker(worker);
                callback(message);
            });
            worker.childProcess.on('error', (message) => {
                this.removeWorker(worker);
                callback({ error: new sandbox_1.HostError('worker error') });
            });
            worker.childProcess.on('disconnect', () => {
                this.removeWorker(worker);
                callback({ error: new sandbox_1.HostError('worker disconnected') });
            });
            worker.childProcess.on('exit', (message) => {
                this.removeWorker(worker);
            });
            if (timeout > 0) {
                worker.executionTimeout = setTimeout(() => {
                    this.removeWorker(worker);
                    callback({ error: new sandbox_1.TimeoutError(timeout) });
                }, timeout);
            }
            worker.childProcess.send({
                code,
                globals: JSON.stringify(globals),
                context: JSON.stringify(context),
            });
        });
    }
}
exports.default = Cluster;
//# sourceMappingURL=cluster.js.map