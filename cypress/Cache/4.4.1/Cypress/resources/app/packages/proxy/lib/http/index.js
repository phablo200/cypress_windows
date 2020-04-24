"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var lodash_1 = __importDefault(require("lodash"));
var debug_1 = __importDefault(require("debug"));
var error_middleware_1 = __importDefault(require("./error-middleware"));
var buffers_1 = require("./util/buffers");
var bluebird_1 = __importDefault(require("bluebird"));
var request_middleware_1 = __importDefault(require("./request-middleware"));
var response_middleware_1 = __importDefault(require("./response-middleware"));
var debug = debug_1.default('cypress:proxy:http');
var HttpStages;
(function (HttpStages) {
    HttpStages[HttpStages["IncomingRequest"] = 0] = "IncomingRequest";
    HttpStages[HttpStages["IncomingResponse"] = 1] = "IncomingResponse";
    HttpStages[HttpStages["Error"] = 2] = "Error";
})(HttpStages = exports.HttpStages || (exports.HttpStages = {}));
var READONLY_MIDDLEWARE_KEYS = [
    'buffers',
    'config',
    'getFileServerToken',
    'getRemoteState',
    'request',
    'next',
    'end',
    'onResponse',
    'onError',
    'skipMiddleware',
];
function _runStage(type, ctx) {
    var stage = HttpStages[type];
    debug('Entering stage %o', { stage: stage });
    var runMiddlewareStack = function () {
        var middlewares = ctx.middleware[type];
        // pop the first pair off the middleware
        var middlewareName = lodash_1.default.keys(middlewares)[0];
        if (!middlewareName) {
            return bluebird_1.default.resolve();
        }
        var middleware = middlewares[middlewareName];
        ctx.middleware[type] = lodash_1.default.omit(middlewares, middlewareName);
        return new bluebird_1.default(function (resolve) {
            var ended = false;
            function copyChangedCtx() {
                lodash_1.default.chain(fullCtx)
                    .omit(READONLY_MIDDLEWARE_KEYS)
                    .forEach(function (value, key) {
                    if (ctx[key] !== value) {
                        ctx[key] = value;
                    }
                })
                    .value();
            }
            function _end(retval) {
                if (ended) {
                    return;
                }
                ended = true;
                copyChangedCtx();
                resolve(retval);
            }
            if (!middleware) {
                return resolve();
            }
            debug('Running middleware %o', { stage: stage, middlewareName: middlewareName });
            var fullCtx = __assign({ next: function () {
                    copyChangedCtx();
                    _end(runMiddlewareStack());
                }, end: function () { return _end(); }, onResponse: function (incomingRes, resStream) {
                    ctx.incomingRes = incomingRes;
                    ctx.incomingResStream = resStream;
                    _end();
                }, onError: function (error) {
                    debug('Error in middleware %o', { stage: stage, middlewareName: middlewareName, error: error });
                    if (type === HttpStages.Error) {
                        return;
                    }
                    ctx.error = error;
                    _end(_runStage(HttpStages.Error, ctx));
                }, skipMiddleware: function (name) {
                    ctx.middleware[type] = lodash_1.default.omit(ctx.middleware[type], name);
                } }, ctx);
            try {
                middleware.call(fullCtx);
            }
            catch (err) {
                fullCtx.onError(err);
            }
        });
    };
    return runMiddlewareStack()
        .then(function () {
        debug('Leaving stage %o', { stage: stage });
    });
}
exports._runStage = _runStage;
var Http = /** @class */ (function () {
    function Http(opts) {
        var _a;
        this.buffers = new buffers_1.HttpBuffers();
        this.config = opts.config;
        this.getFileServerToken = opts.getFileServerToken;
        this.getRemoteState = opts.getRemoteState;
        this.request = opts.request;
        if (typeof opts.middleware === 'undefined') {
            this.middleware = (_a = {},
                _a[HttpStages.IncomingRequest] = request_middleware_1.default,
                _a[HttpStages.IncomingResponse] = response_middleware_1.default,
                _a[HttpStages.Error] = error_middleware_1.default,
                _a);
        }
        else {
            this.middleware = opts.middleware;
        }
    }
    Http.prototype.handle = function (req, res) {
        var ctx = {
            req: req,
            res: res,
            buffers: this.buffers,
            config: this.config,
            getFileServerToken: this.getFileServerToken,
            getRemoteState: this.getRemoteState,
            request: this.request,
            middleware: lodash_1.default.cloneDeep(this.middleware),
        };
        return _runStage(HttpStages.IncomingRequest, ctx)
            .then(function () {
            if (ctx.incomingRes) {
                return _runStage(HttpStages.IncomingResponse, ctx);
            }
            return debug('warning: Request was not fulfilled with a response.');
        });
    };
    Http.prototype.reset = function () {
        this.buffers.reset();
    };
    Http.prototype.setBuffer = function (buffer) {
        return this.buffers.set(buffer);
    };
    return Http;
}());
exports.Http = Http;
