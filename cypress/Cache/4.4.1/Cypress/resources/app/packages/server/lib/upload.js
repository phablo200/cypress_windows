(function() {
  var Promise, fs, r, rp;

  r = require("@cypress/request");

  rp = require("@cypress/request-promise");

  Promise = require("bluebird");

  fs = require("./util/fs");

  module.exports = {
    send: function(pathToFile, url) {
      return fs.readFileAsync(pathToFile).then(function(buf) {
        return rp({
          url: url,
          method: "PUT",
          body: buf
        });
      });
    }
  };

}).call(this);
