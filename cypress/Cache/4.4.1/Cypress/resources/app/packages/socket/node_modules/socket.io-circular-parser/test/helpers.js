var parser = require('../index.js');
var expect = require('expect');
var encoder = new parser.Encoder();

// tests encoding and decoding a single packet
module.exports.test = function(obj, cb){
  encoder.encode(obj, function(encodedPackets) {
    var decoder = new parser.Decoder();
    decoder.on('decoded', function(packet) {
      expect(packet).toEqual(obj);

      cb && cb()
    });

    decoder.add(encodedPackets[0]);
  });
}

// tests encoding of binary packets
module.exports.test_bin = function test_bin(obj, cb) {
  var originalData = obj.data;
  encoder.encode(obj, function(encodedPackets) {
    var decoder = new parser.Decoder();
    decoder.on('decoded', function(packet) {
      obj.data = originalData;
      obj.attachments = undefined;
      expect(obj).toEqual(packet);

      cb && cb()
    });

    for (var i = 0; i < encodedPackets.length; i++) {
      decoder.add(encodedPackets[i]);
    }
  });
}

// array buffer's slice is native code that is not transported across
// socket.io via msgpack, so regular .eql fails
module.exports.testArrayBuffers = function(buf1, buf2) {
   buf1.slice = undefined;
   buf2.slice = undefined;
   expect(buf1).toEqual(buf2);
}

module.exports.testPacketMetadata = function(p1, p2) {
  expect(p1.type).toEqual(p2.type);
  expect(p1.id).toEqual(p2.id);
  expect(p1.nsp).toEqual(p2.nsp);
}
