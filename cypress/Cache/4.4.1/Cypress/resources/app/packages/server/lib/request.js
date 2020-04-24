(function() {
  var HTTP_CLIENT_REQUEST_EVENTS, NETWORK_ERRORS, Promise, SAMESITE_NONE_RE, SERIALIZABLE_COOKIE_PROPS, TLS_VERSION_ERROR_RE, VERBOSE_REQUEST_OPTS, _, agent, caseInsensitiveGet, caseInsensitiveSet, convertSameSiteToughToExtension, createRetryingRequestPromise, createRetryingRequestStream, debug, duplexify, getDelayForRetry, getOriginalHeaders, hasRetriableStatusCodeFailure, isRetriableError, maybeRetryOnNetworkFailure, maybeRetryOnStatusCodeFailure, merge, pick, pipeEvent, r, rp, setDefaults, statusCode, stream, streamBuffer, tough, url,
    slice = [].slice;

  _ = require("lodash");

  r = require("@cypress/request");

  rp = require("@cypress/request-promise");

  url = require("url");

  tough = require("tough-cookie");

  debug = require("debug")("cypress:server:request");

  Promise = require("bluebird");

  stream = require("stream");

  duplexify = require("duplexify");

  agent = require("../../network").agent;

  statusCode = require("./util/status_code");

  streamBuffer = require("./util/stream_buffer").streamBuffer;

  SERIALIZABLE_COOKIE_PROPS = ['name', 'value', 'domain', 'expiry', 'path', 'secure', 'hostOnly', 'httpOnly', 'sameSite'];

  NETWORK_ERRORS = "ECONNREFUSED ECONNRESET EPIPE EHOSTUNREACH EAI_AGAIN ENOTFOUND".split(" ");

  VERBOSE_REQUEST_OPTS = "followRedirect strictSSL".split(" ");

  HTTP_CLIENT_REQUEST_EVENTS = "abort connect continue information socket timeout upgrade".split(" ");

  TLS_VERSION_ERROR_RE = /TLSV1_ALERT_PROTOCOL_VERSION|UNSUPPORTED_PROTOCOL/;

  SAMESITE_NONE_RE = /; +samesite=(?:'none'|"none"|none)/i;

  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  convertSameSiteToughToExtension = (function(_this) {
    return function(sameSite, setCookie) {
      var isUnspecified;
      isUnspecified = sameSite === "none" && !SAMESITE_NONE_RE.test(setCookie);
      if (isUnspecified) {
        return void 0;
      }
      if (sameSite === 'none') {
        return 'no_restriction';
      }
      return sameSite;
    };
  })(this);

  getOriginalHeaders = function(req) {
    if (req == null) {
      req = {};
    }
    return _.get(req, 'req.headers', req.headers);
  };

  getDelayForRetry = function(options) {
    var attempt, delay, delaysRemaining, err, onElse, onNext, opts, retryIntervals;
    if (options == null) {
      options = {};
    }
    err = options.err, opts = options.opts, delaysRemaining = options.delaysRemaining, retryIntervals = options.retryIntervals, onNext = options.onNext, onElse = options.onElse;
    delay = delaysRemaining.shift();
    if (!_.isNumber(delay)) {
      debug("exhausted all attempts retrying request %o", merge(opts, {
        err: err
      }));
      return onElse();
    }
    attempt = retryIntervals.length - delaysRemaining.length;
    if (delay >= 1000 && _.get(err, "code") === "ECONNREFUSED") {
      delay = delay / 10;
    }
    debug("retrying request %o", merge(opts, {
      delay: delay,
      attempt: attempt
    }));
    return onNext(delay, attempt);
  };

  hasRetriableStatusCodeFailure = function(res, retryOnStatusCodeFailure) {
    return _.every([retryOnStatusCodeFailure, !statusCode.isOk(res.statusCode)]);
  };

  isRetriableError = function(err, retryOnNetworkFailure) {
    if (err == null) {
      err = {};
    }
    return _.every([retryOnNetworkFailure, _.includes(NETWORK_ERRORS, err.code)]);
  };

  maybeRetryOnNetworkFailure = function(err, options) {
    var delaysRemaining, isTlsVersionError, onElse, onNext, opts, retryIntervals, retryOnNetworkFailure;
    if (options == null) {
      options = {};
    }
    opts = options.opts, retryIntervals = options.retryIntervals, delaysRemaining = options.delaysRemaining, retryOnNetworkFailure = options.retryOnNetworkFailure, onNext = options.onNext, onElse = options.onElse;
    debug("received an error making http request %o", merge(opts, {
      err: err
    }));
    isTlsVersionError = TLS_VERSION_ERROR_RE.test(err.message);
    if (isTlsVersionError) {
      debug('detected TLS version error, setting min version to TLSv1');
      opts.minVersion = 'TLSv1';
    }
    if (!isTlsVersionError && !isRetriableError(err, retryOnNetworkFailure)) {
      return onElse();
    }
    return getDelayForRetry({
      err: err,
      opts: opts,
      retryIntervals: retryIntervals,
      delaysRemaining: delaysRemaining,
      onNext: onNext,
      onElse: onElse
    });
  };

  maybeRetryOnStatusCodeFailure = function(res, options) {
    var delaysRemaining, err, onElse, onNext, opts, requestId, retryIntervals, retryOnStatusCodeFailure;
    if (options == null) {
      options = {};
    }
    err = options.err, opts = options.opts, requestId = options.requestId, retryIntervals = options.retryIntervals, delaysRemaining = options.delaysRemaining, retryOnStatusCodeFailure = options.retryOnStatusCodeFailure, onNext = options.onNext, onElse = options.onElse;
    debug("received status code & headers on request %o", {
      requestId: requestId,
      statusCode: res.statusCode,
      headers: _.pick(res.headers, 'content-type', 'set-cookie', 'location')
    });
    if (!hasRetriableStatusCodeFailure(res, retryOnStatusCodeFailure)) {
      return onElse();
    }
    return getDelayForRetry({
      err: err,
      opts: opts,
      retryIntervals: retryIntervals,
      delaysRemaining: delaysRemaining,
      onNext: onNext,
      onElse: onElse
    });
  };

  merge = function() {
    var args, ref;
    args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    return (ref = _.chain({})).extend.apply(ref, args).omit(VERBOSE_REQUEST_OPTS).value();
  };

  pick = function(resp) {
    var headers, ref, ref1, ref2, req;
    if (resp == null) {
      resp = {};
    }
    req = (ref = resp.request) != null ? ref : {};
    headers = getOriginalHeaders(req);
    return {
      "Request Body": (ref1 = req.body) != null ? ref1 : null,
      "Request Headers": headers,
      "Request URL": req.href,
      "Response Body": (ref2 = resp.body) != null ? ref2 : null,
      "Response Headers": resp.headers,
      "Response Status": resp.statusCode
    };
  };

  createRetryingRequestPromise = function(opts) {
    var delaysRemaining, requestId, retry, retryIntervals, retryOnNetworkFailure, retryOnStatusCodeFailure;
    requestId = opts.requestId, retryIntervals = opts.retryIntervals, delaysRemaining = opts.delaysRemaining, retryOnNetworkFailure = opts.retryOnNetworkFailure, retryOnStatusCodeFailure = opts.retryOnStatusCodeFailure;
    retry = function(delay) {
      return Promise.delay(delay).then(function() {
        return createRetryingRequestPromise(opts);
      });
    };
    return rp(opts)["catch"](function(err) {
      return maybeRetryOnNetworkFailure(err.error || err, {
        opts: opts,
        retryIntervals: retryIntervals,
        delaysRemaining: delaysRemaining,
        retryOnNetworkFailure: retryOnNetworkFailure,
        onNext: retry,
        onElse: function() {
          throw err;
        }
      });
    }).then(function(res) {
      return maybeRetryOnStatusCodeFailure(res, {
        opts: opts,
        requestId: requestId,
        retryIntervals: retryIntervals,
        delaysRemaining: delaysRemaining,
        retryOnStatusCodeFailure: retryOnStatusCodeFailure,
        onNext: retry,
        onElse: _.constant(res)
      });
    });
  };

  pipeEvent = function(source, destination, event) {
    return source.on(event, function() {
      var args;
      args = 1 <= arguments.length ? slice.call(arguments, 0) : [];
      return destination.emit.apply(destination, [event].concat(slice.call(args)));
    });
  };

  createRetryingRequestStream = function(opts) {
    var cleanup, delayStream, delaysRemaining, emitError, req, reqBodyBuffer, requestId, retryIntervals, retryOnNetworkFailure, retryOnStatusCodeFailure, retryStream, tryStartStream;
    if (opts == null) {
      opts = {};
    }
    requestId = opts.requestId, retryIntervals = opts.retryIntervals, delaysRemaining = opts.delaysRemaining, retryOnNetworkFailure = opts.retryOnNetworkFailure, retryOnStatusCodeFailure = opts.retryOnStatusCodeFailure;
    req = null;
    delayStream = stream.PassThrough();
    reqBodyBuffer = streamBuffer();
    retryStream = duplexify(reqBodyBuffer, delayStream);
    cleanup = function() {
      if (reqBodyBuffer) {
        reqBodyBuffer.unpipeAll();
        return reqBodyBuffer = null;
      }
    };
    emitError = function(err) {
      retryStream.emit("error", err);
      return cleanup();
    };
    tryStartStream = function() {
      var didReceiveResponse, onPiped, reqStream, retry;
      if (retryStream.aborted) {
        return;
      }
      reqStream = r(opts);
      didReceiveResponse = false;
      retry = function(delay, attempt) {
        retryStream.emit("retry", {
          attempt: attempt,
          delay: delay
        });
        return setTimeout(tryStartStream, delay);
      };
      if (req) {
        reqStream.emit('pipe', req);
        reqBodyBuffer.createReadStream().pipe(reqStream);
      }
      retryStream.abort = function() {
        debug('aborting', {
          requestId: requestId
        });
        retryStream.aborted = true;
        return reqStream.abort();
      };
      onPiped = function(src) {
        req = src;
        return src.pipe(reqStream);
      };
      retryStream.once("pipe", onPiped);
      reqStream.on("error", function(err) {
        if (didReceiveResponse) {
          debug("received an error on request after response started %o", merge(opts, {
            err: err
          }));
          return emitError(err);
        }
        return maybeRetryOnNetworkFailure(err, {
          opts: opts,
          retryIntervals: retryIntervals,
          delaysRemaining: delaysRemaining,
          retryOnNetworkFailure: retryOnNetworkFailure,
          onNext: retry,
          onElse: function() {
            return emitError(err);
          }
        });
      });
      reqStream.once("request", function(req) {
        return retryStream.removeListener("pipe", onPiped);
      });
      return reqStream.once("response", function(incomingRes) {
        didReceiveResponse = true;
        return maybeRetryOnStatusCodeFailure(incomingRes, {
          opts: opts,
          requestId: requestId,
          delaysRemaining: delaysRemaining,
          retryIntervals: retryIntervals,
          retryOnStatusCodeFailure: retryOnStatusCodeFailure,
          onNext: retry,
          onElse: function() {
            debug("successful response received", {
              requestId: requestId
            });
            cleanup();
            retryStream.emit("response", incomingRes);
            reqStream.pipe(delayStream);
            return _.map(HTTP_CLIENT_REQUEST_EVENTS, _.partial(pipeEvent, reqStream, retryStream));
          }
        });
      });
    };
    tryStartStream();
    return retryStream;
  };

  caseInsensitiveGet = function(obj, property) {
    var i, key, len, lowercaseProperty, ref;
    lowercaseProperty = property.toLowerCase();
    ref = Object.keys(obj);
    for (i = 0, len = ref.length; i < len; i++) {
      key = ref[i];
      if (key.toLowerCase() === lowercaseProperty) {
        return obj[key];
      }
    }
  };

  caseInsensitiveSet = function(obj, property, val) {
    var i, key, len, lowercaseProperty, ref;
    lowercaseProperty = property.toLowerCase();
    ref = Object.keys(obj);
    for (i = 0, len = ref.length; i < len; i++) {
      key = ref[i];
      if (key.toLowerCase() === lowercaseProperty) {
        return obj[key] = val;
      }
    }
    return obj[lowercaseProperty] = val;
  };

  setDefaults = function(opts) {
    return _.chain(opts).defaults({
      requestId: _.uniqueId('request'),
      retryIntervals: [0, 1000, 2000, 2000],
      retryOnNetworkFailure: true,
      retryOnStatusCodeFailure: false
    }).thru(function(opts) {
      return _.defaults(opts, {
        delaysRemaining: _.clone(opts.retryIntervals)
      });
    }).value();
  };

  module.exports = function(options) {
    var defaults;
    if (options == null) {
      options = {};
    }
    defaults = {
      timeout: options.timeout,
      agent: agent,
      headers: {
        "Connection": "keep-alive"
      },
      proxy: null
    };
    r = r.defaults(defaults);
    rp = rp.defaults(defaults);
    return {
      r: require("@cypress/request"),
      rp: require("@cypress/request-promise"),
      getDelayForRetry: getDelayForRetry,
      setDefaults: setDefaults,
      create: function(strOrOpts, promise) {
        var opts;
        switch (false) {
          case !_.isString(strOrOpts):
            opts = {
              url: strOrOpts
            };
            break;
          default:
            opts = strOrOpts;
        }
        opts = setDefaults(opts);
        if (promise) {
          return createRetryingRequestPromise(opts);
        } else {
          return createRetryingRequestStream(opts);
        }
      },
      contentTypeIsJson: function(response) {
        var ref, ref1;
        return response != null ? (ref = response.headers) != null ? (ref1 = ref["content-type"]) != null ? ref1.split(';', 2)[0].endsWith("json") : void 0 : void 0 : void 0;
      },
      parseJsonBody: function(body) {
        var e;
        try {
          return JSON.parse(body);
        } catch (error) {
          e = error;
          return body;
        }
      },
      normalizeResponse: function(push, response) {
        var ref, req;
        req = (ref = response.request) != null ? ref : {};
        push(response);
        response = _.pick(response, "statusCode", "body", "headers");
        response.status = response.statusCode;
        delete response.statusCode;
        _.extend(response, {
          statusText: statusCode.getText(response.status),
          isOkStatusCode: statusCode.isOk(response.status),
          requestHeaders: getOriginalHeaders(req),
          requestBody: req.body
        });
        if (_.isString(response.body) && this.contentTypeIsJson(response)) {
          response.body = this.parseJsonBody(response.body);
        }
        return response;
      },
      setRequestCookieHeader: function(req, reqUrl, automationFn, existingHeader) {
        return automationFn('get:cookies', {
          url: reqUrl
        }).then(function(cookies) {
          var header;
          debug('got cookies from browser %o', {
            reqUrl: reqUrl,
            cookies: cookies
          });
          header = cookies.map(function(cookie) {
            return cookie.name + "=" + cookie.value;
          }).join("; ") || void 0;
          if (header) {
            if (existingHeader) {
              debug('there is an existing cookie header, merging %o', {
                header: header,
                existingHeader: existingHeader
              });
              header = [existingHeader, header].join(';');
            }
            return caseInsensitiveSet(req.headers, 'Cookie', header);
          }
        });
      },
      setCookiesOnBrowser: function(res, resUrl, automationFn) {
        var cookies, defaultDomain, parsedUrl;
        cookies = res.headers['set-cookie'];
        if (!cookies) {
          return Promise.resolve();
        }
        if (!(cookies instanceof Array)) {
          cookies = [cookies];
        }
        parsedUrl = url.parse(resUrl);
        defaultDomain = parsedUrl.hostname;
        debug('setting cookies on browser %o', {
          url: parsedUrl.href,
          defaultDomain: defaultDomain,
          cookies: cookies
        });
        return Promise.map(cookies, function(cyCookie) {
          var automationCmd, cookie, expiry;
          cookie = tough.Cookie.parse(cyCookie, {
            loose: true
          });
          debug('parsing cookie %o', {
            cyCookie: cyCookie,
            toughCookie: cookie
          });
          if (!cookie) {
            debug('tough-cookie failed to parse, ignoring');
            return;
          }
          cookie.name = cookie.key;
          if (!cookie.domain) {
            cookie.domain = defaultDomain;
            cookie.hostOnly = true;
          }
          if (!tough.domainMatch(defaultDomain, cookie.domain)) {
            debug('domain match failed:', {
              defaultDomain: defaultDomain
            });
            return;
          }
          expiry = cookie.expiryTime();
          if (isFinite(expiry)) {
            cookie.expiry = expiry / 1000;
          }
          cookie.sameSite = convertSameSiteToughToExtension(cookie.sameSite, cyCookie);
          cookie = _.pick(cookie, SERIALIZABLE_COOKIE_PROPS);
          automationCmd = 'set:cookie';
          if (expiry <= 0) {
            automationCmd = 'clear:cookie';
          }
          return automationFn(automationCmd, cookie)["catch"](function(err) {
            return debug('automation threw an error during cookie change %o', {
              automationCmd: automationCmd,
              cyCookie: cyCookie,
              cookie: cookie,
              err: err
            });
          });
        });
      },
      sendStream: function(headers, automationFn, options) {
        var currentUrl, followRedirect, self, ua;
        if (options == null) {
          options = {};
        }
        _.defaults(options, {
          headers: {},
          onBeforeReqInit: function(fn) {
            return fn();
          }
        });
        if (!caseInsensitiveGet(options.headers, "user-agent") && (ua = headers["user-agent"])) {
          options.headers["user-agent"] = ua;
        }
        _.extend(options, {
          strictSSL: false
        });
        self = this;
        followRedirect = options.followRedirect;
        currentUrl = options.url;
        options.followRedirect = function(incomingRes) {
          var newUrl;
          if (followRedirect && !followRedirect(incomingRes)) {
            return false;
          }
          newUrl = url.resolve(currentUrl, incomingRes.headers.location);
          return self.setCookiesOnBrowser(incomingRes, currentUrl, automationFn).then((function(_this) {
            return function(cookies) {
              return self.setRequestCookieHeader(_this, newUrl, automationFn);
            };
          })(this)).then((function(_this) {
            return function() {
              currentUrl = newUrl;
              return true;
            };
          })(this));
        };
        return this.setRequestCookieHeader(options, options.url, automationFn, caseInsensitiveGet(options.headers, 'cookie')).then((function(_this) {
          return function() {
            return function() {
              debug("sending request as stream %o", merge(options));
              return _this.create(options);
            };
          };
        })(this));
      },
      sendPromise: function(headers, automationFn, options) {
        var a, c, self, send, ua;
        if (options == null) {
          options = {};
        }
        _.defaults(options, {
          headers: {},
          gzip: true,
          cookies: true,
          followRedirect: true
        });
        if (!caseInsensitiveGet(options.headers, "user-agent") && (ua = headers["user-agent"])) {
          options.headers["user-agent"] = ua;
        }
        if (a = options.headers.Accept) {
          delete options.headers.Accept;
          options.headers.accept = a;
        }
        _.defaults(options.headers, {
          accept: "*/*"
        });
        _.extend(options, {
          strictSSL: false,
          simple: false,
          resolveWithFullResponse: true
        });
        options.followAllRedirects = options.followRedirect;
        if (options.form === true) {
          options.form = options.body;
          delete options.json;
          delete options.body;
        }
        self = this;
        send = (function(_this) {
          return function() {
            var currentUrl, ms, push, redirects, requestResponses;
            ms = Date.now();
            redirects = [];
            requestResponses = [];
            push = function(response) {
              return requestResponses.push(pick(response));
            };
            currentUrl = options.url;
            if (options.followRedirect) {
              options.followRedirect = function(incomingRes) {
                var newUrl;
                newUrl = url.resolve(currentUrl, incomingRes.headers.location);
                redirects.push([incomingRes.statusCode, newUrl].join(": "));
                push(incomingRes);
                return self.setCookiesOnBrowser(incomingRes, currentUrl, automationFn).then((function(_this) {
                  return function() {
                    return self.setRequestCookieHeader(_this, newUrl, automationFn);
                  };
                })(this)).then((function(_this) {
                  return function() {
                    currentUrl = newUrl;
                    return true;
                  };
                })(this));
              };
            }
            return _this.create(options, true).then(_this.normalizeResponse.bind(_this, push)).then(function(resp) {
              var loc;
              resp.duration = Date.now() - ms;
              resp.allRequestResponses = requestResponses;
              if (redirects.length) {
                resp.redirects = redirects;
              }
              if (options.followRedirect === false && (loc = resp.headers.location)) {
                resp.redirectedToUrl = url.resolve(options.url, loc);
              }
              return _this.setCookiesOnBrowser(resp, currentUrl, automationFn)["return"](resp);
            });
          };
        })(this);
        if (c = options.cookies) {
          return self.setRequestCookieHeader(options, options.url, automationFn, caseInsensitiveGet(options.headers, 'cookie')).then(send);
        } else {
          return send();
        }
      }
    };
  };

}).call(this);
