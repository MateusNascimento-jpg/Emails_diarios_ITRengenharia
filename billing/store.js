'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./protocol');
// One shared durable volume; exclusive creation also serializes separate processes.
// Locks surviving a crash are NEVER stolen automatically.
class Store {
    constructor(directory) { this.directory = directory; fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); }
    file(key) { return path.join(this.directory, hash(key)); }
    create(key, value) {
        let fd;
        try { fd = fs.openSync(this.file(key), 'wx', 0o600); }
        catch (e) { if (e.code === 'EEXIST') return false; throw e; }
        try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        // Persist the directory entry on deployment platforms supporting directory fsync.
        if (process.platform !== 'win32') {
            const directoryFd = fs.openSync(this.directory, 'r');
            try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
        }
        return true;
    }
    read(key) { try { return JSON.parse(fs.readFileSync(this.file(key), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
    lock(key) { return this.create('lock:' + key, { createdAt: Date.now() }); }
    unlock(key) { fs.unlinkSync(this.file('lock:' + key)); }
}
module.exports = { Store };
