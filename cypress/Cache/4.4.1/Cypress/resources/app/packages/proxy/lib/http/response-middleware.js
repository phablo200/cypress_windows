"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var lodash_1 = __importDefault(require("lodash"));
var charset_1 = __importDefault(require("charset"));
var network_1 = require("../../../network");
var debug_1 = __importDefault(require("debug"));
var iconv_lite_1 = __importDefault(require("iconv-lite"));
var stream_1 = require("stream");
var rewriter = __importStar(require("./util/rewriter"));
var zlib_1 = __importDefault(require("zlib"));
var debug = debug_1.default('cypress:proxy:http:response-middleware');
// https://github.com/cypress-io/cypress/issues/1756
var zlibOptions = {
    flush: zlib_1.default.Z_SYNC_FLUSH,
    finishFlush: zlib_1.default.Z_SYNC_FLUSH,
};
// https://github.com/cypress-io/cypress/issues/1543
function getNodeCharsetFromResponse(headers, body) {
    var httpCharset = (charset_1.default(headers, body, 1024) || '').toLowerCase();
    debug('inferred charset from response %o', { httpCharset: httpCharset });
    if (iconv_lite_1.default.encodingExists(httpCharset)) {
        return httpCharset;
    }
    // browsers default to latin1
    return 'latin1';
}
function reqMatchesOriginPolicy(req, remoteState) {
    if (remoteState.strategy === 'http') {
        return network_1.cors.urlMatchesOriginPolicyProps(req.proxiedUrl, remoteState.props);
    }
    if (remoteState.strategy === 'file') {
        return req.proxiedUrl.startsWith(remoteState.origin);
    }
    return false;
}
function reqWillRenderHtml(req) {
    // will this request be rendered in the browser, necessitating injection?
    // https://github.com/cypress-io/cypress/issues/288
    // don't inject if this is an XHR from jquery
    if (req.headers['x-requested-with']) {
        return;
    }
    // don't inject if we didn't find both text/html and application/xhtml+xml,
    var accept = req.headers['accept'];
    return accept && accept.includes('text/html') && accept.includes('application/xhtml+xml');
}
function resContentTypeIs(res, contentType) {
    return (res.headers['content-type'] || '').includes(contentType);
}
function resContentTypeIsJavaScript(res) {
    return lodash_1.default.some(['application/javascript', 'application/x-javascript', 'text/javascript']
        .map(lodash_1.default.partial(resContentTypeIs, res)));
}
function resIsGzipped(res) {
    return (res.headers['content-encoding'] || '').includes('gzip');
}
// https://github.com/cypress-io/cypress/issues/4298
// https://tools.ietf.org/html/rfc7230#section-3.3.3
// HEAD, 1xx, 204, and 304 responses should never contain anything after headers
var NO_BODY_STATUS_CODES = [204, 304];
function responseMustHaveEmptyBody(req, res) {
    return lodash_1.default.some([lodash_1.default.includes(NO_BODY_STATUS_CODES, res.statusCode), lodash_1.default.invoke(req.method, 'toLowerCase') === 'head']);
}
function setCookie(res, k, v, domain) {
    var opts = { domain: domain };
    if (!v) {
        v = '';
        opts.expires = new Date(0);
    }
    return res.cookie(k, v, opts);
}
function setInitialCookie(res, remoteState, value) {
    // dont modify any cookies if we're trying to clear the initial cookie and we're not injecting anything
    // dont set the cookies if we're not on the initial request
    if ((!value && !res.wantsInjection) || !res.isInitial) {
        return;
    }
    return setCookie(res, '__cypress.initial', value, remoteState.domainName);
}
// "autoplay *; document-domain 'none'" => { autoplay: "*", "document-domain": "'none'" }
var parseFeaturePolicy = function (policy) {
    var pairs = policy.split('; ').map(function (directive) { return directive.split(' '); });
    return lodash_1.default.fromPairs(pairs);
};
// { autoplay: "*", "document-domain": "'none'" } => "autoplay *; document-domain 'none'"
var stringifyFeaturePolicy = function (policy) {
    var pairs = lodash_1.default.toPairs(policy);
    return pairs.map(function (directive) { return directive.join(' '); }).join('; ');
};
var LogResponse = function () {
    debug('received response %o', {
        req: lodash_1.default.pick(this.req, 'method', 'proxiedUrl', 'headers'),
        incomingRes: lodash_1.default.pick(this.incomingRes, 'headers', 'statusCode'),
    });
    this.next();
};
var PatchExpressSetHeader = function () {
    var _this = this;
    var incomingRes = this.incomingRes;
    var originalSetHeader = this.res.setHeader;
    // Node uses their own Symbol object, so use this to get the internal kOutHeaders
    // symbol - Symbol.for('kOutHeaders') will not work
    var getKOutHeadersSymbol = function () {
        var findKOutHeadersSymbol = function () {
            return lodash_1.default.find(Object.getOwnPropertySymbols(_this.res), function (sym) {
                return sym.toString() === 'Symbol(kOutHeaders)';
            });
        };
        var sym = findKOutHeadersSymbol();
        if (sym) {
            return sym;
        }
        // force creation of a new header field so the kOutHeaders key is available
        _this.res.setHeader('X-Cypress-HTTP-Response', 'X');
        _this.res.removeHeader('X-Cypress-HTTP-Response');
        sym = findKOutHeadersSymbol();
        if (!sym) {
            throw new Error('unable to find kOutHeaders symbol');
        }
        return sym;
    };
    var kOutHeaders;
    this.res.setHeader = function (name, value) {
        // express.Response.setHeader does all kinds of silly/nasty stuff to the content-type...
        // but we don't want to change it at all!
        if (name === 'content-type') {
            value = incomingRes.headers['content-type'] || value;
        }
        // run the original function - if an "invalid header char" error is raised,
        // set the header manually. this way we can retain Node's original error behavior
        try {
            return originalSetHeader.call(this, name, value);
        }
        catch (err) {
            if (err.code !== 'ERR_INVALID_CHAR') {
                throw err;
            }
            debug('setHeader error ignored %o', { name: name, value: value, code: err.code, err: err });
            if (!kOutHeaders) {
                kOutHeaders = getKOutHeadersSymbol();
            }
            // https://github.com/nodejs/node/blob/42cce5a9d0fd905bf4ad7a2528c36572dfb8b5ad/lib/_http_outgoing.js#L483-L495
            var headers = this[kOutHeaders];
            if (!headers) {
                this[kOutHeaders] = headers = Object.create(null);
            }
            headers[name.toLowerCase()] = [name, value];
        }
    };
    this.next();
};
var SetInjectionLevel = function () {
    var _this = this;
    this.res.isInitial = this.req.cookies['__cypress.initial'] === 'true';
    var getInjectionLevel = function () {
        if (_this.incomingRes.headers['x-cypress-file-server-error'] && !_this.res.isInitial) {
            return 'partial';
        }
        if (!resContentTypeIs(_this.incomingRes, 'text/html') || !reqMatchesOriginPolicy(_this.req, _this.getRemoteState())) {
            return false;
        }
        if (_this.res.isInitial) {
            return 'full';
        }
        if (!reqWillRenderHtml(_this.req)) {
            return false;
        }
        return 'partial';
    };
    if (!this.res.wantsInjection) {
        this.res.wantsInjection = getInjectionLevel();
    }
    this.res.wantsSecurityRemoved = this.config.modifyObstructiveCode && ((this.res.wantsInjection === 'full')
        || resContentTypeIsJavaScript(this.incomingRes));
    debug('injection levels: %o', lodash_1.default.pick(this.res, 'isInitial', 'wantsInjection', 'wantsSecurityRemoved'));
    this.next();
};
// https://github.com/cypress-io/cypress/issues/6480
var MaybeStripDocumentDomainFeaturePolicy = function () {
    var featurePolicy = this.incomingRes.headers["feature-policy"];
    if (featurePolicy) {
        var directives = parseFeaturePolicy(featurePolicy);
        if (directives['document-domain']) {
            delete directives['document-domain'];
            var policy = stringifyFeaturePolicy(directives);
            if (policy) {
                this.res.set('feature-policy', policy);
            }
            else {
                this.res.removeHeader('feature-policy');
            }
        }
    }
    this.next();
};
var OmitProblematicHeaders = function () {
    var headers = lodash_1.default.omit(this.incomingRes.headers, [
        'set-cookie',
        'x-frame-options',
        'content-length',
        'content-security-policy',
        'connection',
    ]);
    this.res.set(headers);
    this.next();
};
var MaybePreventCaching = function () {
    // do not cache injected responses
    // TODO: consider implementing etag system so even injected content can be cached
    if (this.res.wantsInjection) {
        this.res.setHeader('cache-control', 'no-cache, no-store, must-revalidate');
    }
    this.next();
};
var CopyCookiesFromIncomingRes = function () {
    var _this = this;
    var cookies = this.incomingRes.headers['set-cookie'];
    if (cookies) {
        [].concat(cookies).forEach(function (cookie) {
            try {
                _this.res.append('Set-Cookie', cookie);
            }
            catch (err) {
                debug('failed to Set-Cookie, continuing %o', { err: err, cookie: cookie });
            }
        });
    }
    this.next();
};
var REDIRECT_STATUS_CODES = [301, 302, 303, 307, 308];
// TODO: this shouldn't really even be necessary?
var MaybeSendRedirectToClient = function () {
    var _a = this.incomingRes, statusCode = _a.statusCode, headers = _a.headers;
    var newUrl = headers['location'];
    if (!REDIRECT_STATUS_CODES.includes(statusCode) || !newUrl) {
        return this.next();
    }
    setInitialCookie(this.res, this.getRemoteState(), true);
    debug('redirecting to new url %o', { statusCode: statusCode, newUrl: newUrl });
    this.res.redirect(Number(statusCode), newUrl);
    return this.end();
};
var CopyResponseStatusCode = function () {
    this.res.status(Number(this.incomingRes.statusCode));
    this.next();
};
var ClearCyInitialCookie = function () {
    setInitialCookie(this.res, this.getRemoteState(), false);
    this.next();
};
var MaybeEndWithEmptyBody = function () {
    if (responseMustHaveEmptyBody(this.req, this.incomingRes)) {
        this.res.end();
        return this.end();
    }
    this.next();
};
var MaybeGunzipBody = function () {
    if (resIsGzipped(this.incomingRes) && (this.res.wantsInjection || this.res.wantsSecurityRemoved)) {
        debug('ungzipping response body');
        var gunzip = zlib_1.default.createGunzip(zlibOptions);
        this.incomingResStream = this.incomingResStream.pipe(gunzip).on('error', this.onError);
    }
    else {
        this.skipMiddleware('GzipBody'); // not needed anymore
    }
    this.next();
};
var MaybeInjectHtml = function () {
    var _this = this;
    if (!this.res.wantsInjection) {
        return this.next();
    }
    this.skipMiddleware('MaybeRemoveSecurity'); // we only want to do one or the other
    debug('injecting into HTML');
    this.incomingResStream.pipe(network_1.concatStream(function (body) {
        var nodeCharset = getNodeCharsetFromResponse(_this.incomingRes.headers, body);
        var decodedBody = iconv_lite_1.default.decode(body, nodeCharset);
        var injectedBody = rewriter.html(decodedBody, _this.getRemoteState().domainName, _this.res.wantsInjection, _this.res.wantsSecurityRemoved);
        var encodedBody = iconv_lite_1.default.encode(injectedBody, nodeCharset);
        var pt = new stream_1.PassThrough;
        pt.write(encodedBody);
        pt.end();
        _this.incomingResStream = pt;
        _this.next();
    })).on('error', this.onError);
};
var MaybeRemoveSecurity = function () {
    if (!this.res.wantsSecurityRemoved) {
        return this.next();
    }
    debug('removing JS framebusting code');
    this.incomingResStream.setEncoding('utf8');
    this.incomingResStream = this.incomingResStream.pipe(rewriter.security()).on('error', this.onError);
    this.next();
};
var GzipBody = function () {
    debug('regzipping response body');
    this.incomingResStream = this.incomingResStream.pipe(zlib_1.default.createGzip(zlibOptions)).on('error', this.onError);
    this.next();
};
var SendResponseBodyToClient = function () {
    var _this = this;
    this.incomingResStream.pipe(this.res).on('error', this.onError);
    this.res.on('end', function () { return _this.end(); });
};
exports.default = {
    LogResponse: LogResponse,
    PatchExpressSetHeader: PatchExpressSetHeader,
    SetInjectionLevel: SetInjectionLevel,
    OmitProblematicHeaders: OmitProblematicHeaders,
    MaybePreventCaching: MaybePreventCaching,
    MaybeStripDocumentDomainFeaturePolicy: MaybeStripDocumentDomainFeaturePolicy,
    CopyCookiesFromIncomingRes: CopyCookiesFromIncomingRes,
    MaybeSendRedirectToClient: MaybeSendRedirectToClient,
    CopyResponseStatusCode: CopyResponseStatusCode,
    ClearCyInitialCookie: ClearCyInitialCookie,
    MaybeEndWithEmptyBody: MaybeEndWithEmptyBody,
    MaybeGunzipBody: MaybeGunzipBody,
    MaybeInjectHtml: MaybeInjectHtml,
    MaybeRemoveSecurity: MaybeRemoveSecurity,
    GzipBody: GzipBody,
    SendResponseBodyToClient: SendResponseBodyToClient,
};
