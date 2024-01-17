function establishConnection(pw, signalServer = 'ws://localhost') {
  return new Promise((res, rej) => {
    if (!pw) pw = prompt('pw');
    const ws = new WebSocket(signalServer);
    ws.binaryType = 'blob';
    ws.addEventListener('error', e => rej(e));
    ws.addEventListener('close', () => rej('socket closed unexpectedly'));
    ws.send = s => WebSocket.prototype.send.call(ws, JSON.stringify(s));

    const config = {
      iceServers: [{
        'urls': [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
          'stun:stun2.l.google.com:19302',
          'stun:stun3.l.google.com:19302',
          'stun:stun4.l.google.com:19302'
        ]
      }],
      iceCandidatePoolSize: 10
    };
    let peerConn;
    ws.addEventListener('open', async () => {
      // ws.send({ pw });
      peerConn = new RTCPeerConnection(config);
      const offer = await peerConn.createOffer();
      await peerConn.setLocalDescription(offer);
      ws.send({ pw, offer });

      peerConn.addEventListener('icecandidate', evn => {
        if (evn.candidate) ws.send({ 'iceCandidate': evn.candidate });
      });
      peerConn.addEventListener('connectionstatechange', () => {
        if (peerConn.connectionState === 'connected') res(peerConn);
      });
    });
    ws.addEventListener('message', async evn => {
      let data = (evn.data instanceof Blob ? await evn.data.text() : evn.data);
      if (!data) return;
      data = JSON.parse(data);
      console.log(data);
      if (data.answer) await peerConn.setRemoteDescription(data.answer);
      if (data.iceCandidate) {
        try {
          await peerConnection.addIceCandidate(data.iceCandidate);
        } catch (e) {
          console.error('Error adding received ice candidate', e);
        }
      }
    });
  });
}

establishConnection().then(/** @param {RTCPeerConnection} conn */ conn => {
  console.log('connected');
  conn.addEventListener('connectionstatechange', () => {
    if (conn.connectionState === 'closed') console.log('connection closed');
  });
}).catch(err => console.error(err));