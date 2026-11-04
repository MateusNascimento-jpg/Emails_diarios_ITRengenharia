'use strict';
// Preload for this local validation only. Never loaded by the application.
const Module = require('node:module');
const original = Module._load;
Module._load = function (name, ...args) {
    if (name === 'dotenv') return { config: () => ({ parsed: {} }) };
    return original.call(this, name, ...args);
};
const net = require('node:net');
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
    const a = Array.isArray(args[0]) ? args[0] : args;
    const host = typeof a[0] === 'object' ? a[0].host : a[1];
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('OFFLINE_NETWORK_BLOCKED');
    return connect.apply(this, args);
};
const originalFetch = global.fetch;
global.fetch = (url, ...args) => {
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('OFFLINE_FETCH_BLOCKED');
    return originalFetch(url, ...args);
};
