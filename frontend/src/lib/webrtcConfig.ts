const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME || "";
const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL || "";

const iceServers: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302"
    ]
  }
];

if (turnUsername && turnCredential) {
  iceServers.push(
    {
      urls: "stun:stun.relay.metered.ca:80"
    },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: turnUsername,
      credential: turnCredential
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: turnUsername,
      credential: turnCredential
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: turnUsername,
      credential: turnCredential
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: turnUsername,
      credential: turnCredential
    }
  );
}

export const rtcConfig: RTCConfiguration = {
  iceServers
};


