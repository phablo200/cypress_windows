"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
var inject = __importStar(require("./inject"));
var security_1 = require("./security");
var doctypeRe = /(<\!doctype.*?>)/i;
var headRe = /(<head(?!er).*?>)/i;
var bodyRe = /(<body.*?>)/i;
var htmlRe = /(<html.*?>)/i;
function html(html, domainName, wantsInjection, wantsSecurityRemoved) {
    var replace = function (re, str) {
        return html.replace(re, str);
    };
    var htmlToInject = (function () {
        switch (wantsInjection) {
            case 'full':
                return inject.full(domainName);
            case 'partial':
                return inject.partial(domainName);
            default:
                return;
        }
    })();
    // strip clickjacking and framebusting
    // from the HTML if we've been told to
    if (wantsSecurityRemoved) {
        html = security_1.strip(html);
    }
    switch (false) {
        case !headRe.test(html):
            return replace(headRe, "$1 " + htmlToInject);
        case !bodyRe.test(html):
            return replace(bodyRe, "<head> " + htmlToInject + " </head> $1");
        case !htmlRe.test(html):
            return replace(htmlRe, "$1 <head> " + htmlToInject + " </head>");
        case !doctypeRe.test(html):
            // if only <!DOCTYPE> content, inject <head> after doctype
            return html + "<head> " + htmlToInject + " </head>";
        default:
            return "<head> " + htmlToInject + " </head>" + html;
    }
}
exports.html = html;
exports.security = security_1.stripStream;
