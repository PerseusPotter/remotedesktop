const { WebSocket } = require('ws');
const { RTCPeerConnection } = require('wrtc');
const { EventEmitter } = require('events');
const authToken = require('fs').readFileSync('./auth.txt').toString('base64');

class ActivePeerConnection extends EventEmitter {
  activeConn;
  incomingConnData = new Map();
  incomingConnAuth = new Set();
  signalServer;
  iceServers;
  incConnTimeout;
  signalSocket;

  /**
   * @param {Object} options
   * @param {string} options.signalServer
   * @param {string[]} options.iceServers
   * @param {number} options.incomingConnectionTimeout
   * @param {number} options.reconnectAttempts
   */
  constructor(options) {
    super();
    options = Object.assign({
      signalServer: 'ws://localhost',
      iceServers: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302'
      ],
      incomingConnectionTimeout: 60_000,
      reconnectAttempts: 5
    }, options || {});

    this.signalServer = options.signalServer;
    if (!options.iceServers.every(v => /^(?:stun:|turn:)([A-Za-z0-9.-]+?):\d+$/.test(v))) throw 'options.iceServers urls must be prefixed with either "stun:" or "turn:" and end with ":<port>"';
    this.iceServers = [{ urls: options.iceServers }];
    this.incConnTimeout = options.incomingConnectionTimeout;
    this.reconnectAttempts = options.reconnectAttempts;

    process.nextTick(() => this._createSignalConnection());
  }

  _createSignalConnection(attempt = this.reconnectAttempts) {
    attempt--;
    this.signalSocket = new WebSocket(this.signalServer, { headers: { authorization: authToken } });
    this.signalSocket.send = s => WebSocket.prototype.send.call(this.signalSocket, JSON.stringify(s));
    this.signalSocket.on('error', e => {
      this.emit('signalerror', e);
    });
    this.signalSocket.on('close', () => {
      this.emit('signalclose');
      if (!attempt) throw 'unable to connect to signal server';
      setTimeout(() => this._createSignalConnection(attempt), 5000);
    });
    this.signalSocket.on('message', data => {
      try {
        data = JSON.parse(data);
      } catch (e) {
        this.emit('error', e);
      }
      switch (data.type) {
        case 'connect':
          this.emit('signalconnect', data.id);
          this._handleSignalConnect(data);
          break;
        case 'disconnect':
          this.emit('signaldisconnect', data.id);
          this._handleSignalDisconnect(data);
          break;
        case 'message':
          this.emit('signalmessage', data);
          if (!this.incomingConnData.has(data.id)) return;
          this._handleSignalMessage(data, this.incomingConnData.get(data.id));
          break;
      }
    });
    this.signalSocket.once('open', () => {
      attempt = this.reconnectAttempts;
      this.emit('signalopen');
      // this.signalSocket.send(authToken);
    });
  }

  _handleSignalConnect(data) {
    const peerConn = new RTCPeerConnection({ iceServers: this.iceServers, iceCandidatePoolSize: 10 });
    console.log('ice gathering state', peerConn.iceGatheringState);
    console.log('connection state', peerConn.connectionState);
    peerConn.addEventListener('icecandidate', evn => {
      console.log('ice candidate', evn.candidate);
      if (evn.candidate) {
        this.emit('peerice', evn.candidate);
        this.signalSocket.send({ action: 'forward', id: data.id, 'iceCandidate': evn.candidate });
      }
    });
    peerConn.addEventListener('icegatheringstatechange', () => console.log('ice gathering state change', peerConn.iceGatheringState));
    peerConn.addEventListener('icecandidateerror', evn => console.log('err', evn));
    peerConn.addEventListener('signalingstatechange', () => {
      console.log('signal state change', peerConn.signalingState);
    });
    peerConn.addEventListener('connectionstatechange', () => {
      console.log('connection state change', peerConn.connectionState);
      if (peerConn.connectionState === 'connected') {
        this.activeConn = peerConn;
        this.emit('open', this.activeConn);
      }
      if (peerConn.connectionState === 'closed') {
        this.emit('close', this.activeConn);
        this.activeConn = null;
      }
    });
    this.incomingConnData.set(data.id, peerConn);
    setTimeout(() => {
      peerConn.close();
      this.incomingConnData.delete(data.id)
    }, this.incConnTimeout);
  }
  _handleSignalDisconnect(data) {
    this.incomingConnData.delete(data.id);
    this.incomingConnAuth.delete(data.id);
  }
  /**
   * @param {RTCPeerConnection} peerConn
   */
  async _handleSignalMessage(data, peerConn) {
    // console.log(data);
    if (data.pw && data.pw === 'cheese') {
      this.emit('peerauth');
      this.incomingConnAuth.add(data.id);
    }
    if (!this.incomingConnAuth.has(data.id)) return this.signalSocket.send({ action: 'disconnect', id: data.id, reason: 'not authenticated' });

    if (data.offer) {
      this.emit('peeroffer', data.offer);
      await peerConn.setRemoteDescription(data.offer);
      const answer = await peerConn.createAnswer();
      await peerConn.setLocalDescription(answer);
      this.signalSocket.send({ action: 'forward', id: data.id, 'answer': answer });
      this.emit('peeranswer', answer);
    }
    if (data.iceCandidate) {
      try {
        await peerConn.addIceCandidate(data.iceCandidate);
        this.emit('peerice', data.iceCandidate);
      } catch (e) {
        this.emit('peererror', e);
      }
    }
  }

  emit(...args) {
    console.log('emitting event', args[0]);
    // if (args.length > 1) console.log(args.slice(1));
    super.emit.apply(this, args);
  }
}

module.exports = ActivePeerConnection;