"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var lodash_1 = require("lodash");
/**
 * Returns a single string with human-readable experiments.
  ```
  const experimental = getExperimentsFromResolved(config.resolved)
  const enabledExperiments = _.pickBy(experimental, (experiment) => experiment.enabled)
  formatExperiments(enabledExperiments)
  // "componentsTesting=true,featureB=false"
  ```
 */
exports.formatExperiments = function (exp) {
    return Object.keys(exp).map(function (name) { return name + "=" + exp[name].value; }).join(',');
};
/**
 * Keeps summaries of experiments. Each summary is 1 - 2 sentences
 * describing the purpose of the experiment.
 * When adding an experiment, add its summary text here.
 *
 * @example
  ```
  {
    experimentalComponentTesting: 'Allows mounting and testing framework-specific components'
  }
  ```
*/
var _summaries = {
    experimentalGetCookiesSameSite: 'Adds `sameSite` values to the objects yielded from `cy.setCookie()`, `cy.getCookie()`, and `cy.getCookies()`. This will become the default behavior in Cypress 5.0.',
};
/**
 * Keeps short names for experiments. When adding new experiments, add a short name.
 * The name and summary will be shown in the Settings tab of the Desktop GUI.
 * @example
  ```
  {
    experimentalComponentTesting: 'Component Testing'
  }
  ```
*/
var _names = {
    experimentalGetCookiesSameSite: 'Set `sameSite` property when retrieving cookies',
};
/**
 * Export this object for easy stubbing from end-to-end tests.
 * If you cannot easily pass "names" and "summaries" arguments
 * to "getExperimentsFromResolved" function, then use this
 * object to change "experiments.names" and "experimental.summaries" objects.
*/
exports.experimental = {
    names: _names,
    summaries: _summaries,
};
exports.getExperimentsFromResolved = function (resolvedConfig, names, summaries) {
    if (names === void 0) { names = exports.experimental.names; }
    if (summaries === void 0) { summaries = exports.experimental.summaries; }
    var experiments = {};
    if (!resolvedConfig) {
        // no config - no experiments
        // this is likely to happen during unit testing
        return experiments;
    }
    var isExperimentKey = function (key) { return key.startsWith('experimental'); };
    var experimentalKeys = Object.keys(resolvedConfig).filter(isExperimentKey);
    experimentalKeys.forEach(function (key) {
        var name = lodash_1.get(names, key);
        if (!name) {
            // ignore unknown experiments
            return;
        }
        var summary = lodash_1.get(summaries, key, 'top secret');
        // it would be nice to have default value in the resolved config
        experiments[key] = {
            key: key,
            value: resolvedConfig[key].value,
            enabled: resolvedConfig[key].from !== 'default',
            name: name,
            summary: summary,
        };
    });
    return experiments;
};
/**
 * Looks at the resolved config, finds all keys that start with "experimental" prefix
 * and have non-default values and returns a simple object with {key: {value, enabled}}
 * where "on" is set to true if the value is different from default..
 */
exports.getExperiments = function (project, names, summaries) {
    if (names === void 0) { names = exports.experimental.names; }
    if (summaries === void 0) { summaries = exports.experimental.summaries; }
    var resolvedEnv = lodash_1.get(project, 'resolvedConfig', {});
    return exports.getExperimentsFromResolved(resolvedEnv, names, summaries);
};
/**
 * Whilelist known experiments here to avoid accidentally showing
 * any config key that starts with "experimental" prefix
*/
// @ts-ignore
exports.isKnownExperiment = function (experiment, key) {
    return Object.keys(exports.experimental.names).includes(key);
};
