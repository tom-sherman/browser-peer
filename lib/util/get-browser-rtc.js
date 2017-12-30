'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = getBrowserRTC;
// originally pulled out of simple-peer
// TODO: Add copyright: https://github.com/substack/get-browser-rtc
function getBrowserRTC() {
  if (typeof window === 'undefined') return null;
  var wrtc = {
    RTCPeerConnection: window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection,
    RTCSessionDescription: window.RTCSessionDescription || window.mozRTCSessionDescription || window.webkitRTCSessionDescription,
    RTCIceCandidate: window.RTCIceCandidate || window.mozRTCIceCandidate || window.webkitRTCIceCandidate
  };
  if (!wrtc.RTCPeerConnection) return null;
  return wrtc;
}