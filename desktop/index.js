const ActivePeerConnection = new (require('./connection'))();

ActivePeerConnection.on('error', console.error);
ActivePeerConnection.on('open', () => {
  console.log('open');
});
ActivePeerConnection.on('close', () => {
  console.log('close');
});