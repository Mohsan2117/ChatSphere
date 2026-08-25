"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
  RotateCw,
  ChevronLeft,
  ChevronUp,
  UserPlus,
  Volume2
} from "lucide-react";
import { ChatSeed } from "@/lib/data";
import { rtcConfig } from "@/lib/webrtcConfig";

export type CallState = "idle" | "outgoing" | "incoming" | "connecting" | "connected" | "rejected" | "ended";

export function useAudioCall(
  currentUserId: string,
  socketRef: React.RefObject<WebSocket | null>,
  directoryChats: ChatSeed[]
) {
  const [callState, setCallState] = useState<CallState>("idle");
  const [callId, setCallId] = useState<string | null>(null);
  const [remoteUser, setRemoteUser] = useState<ChatSeed | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  // Group and Video Call states
  const [callType, setCallType] = useState<"audio" | "video">("audio");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isInvite, setIsInvite] = useState(false);

  // Group Multi-Peer structures
  const [participants, setParticipants] = useState<ChatSeed[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [participantsCameraOn, setParticipantsCameraOn] = useState<Map<string, boolean>>(new Map());
  const [participantsMuted, setParticipantsMuted] = useState<Map<string, boolean>>(new Map());

  // Refs for WebRTC resources
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudiosRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const iceCandidatesBuffersRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteOffersRef = useRef<Map<string, any>>(new Map());
  const peerDisconnectTimeoutsRef = useRef<Map<string, any>>(new Map());

  const durationIntervalRef = useRef<any>(null);
  const connectionTimeoutRef = useRef<any>(null);

  // Safe references to prevent stale closures in event handlers
  const callStateRef = useRef<CallState>("idle");
  const callIdRef = useRef<string | null>(null);
  const remoteUserRef = useRef<ChatSeed | null>(null);
  const callTypeRef = useRef<"audio" | "video">("audio");
  const isCameraOnRef = useRef<boolean>(true);
  const facingModeRef = useRef<"user" | "environment">("user");

  useEffect(() => {
    callStateRef.current = callState;
    if (typeof window !== "undefined") {
      const bridge = (window as any).AndroidBridge;
      if (bridge && typeof bridge.setCallActive === "function") {
        const isActive = callState !== "idle" && callState !== "rejected" && callState !== "ended";
        try {
          bridge.setCallActive(isActive);
          console.log(`Notified AndroidBridge: setCallActive(${isActive})`);
        } catch (e) {
          console.error("Failed to call AndroidBridge.setCallActive:", e);
        }
      }
    }
  }, [callState]);

  useEffect(() => {
    callIdRef.current = callId;
  }, [callId]);

  useEffect(() => {
    remoteUserRef.current = remoteUser;
  }, [remoteUser]);

  useEffect(() => {
    callTypeRef.current = callType;
  }, [callType]);

  useEffect(() => {
    isCameraOnRef.current = isCameraOn;
  }, [isCameraOn]);

  useEffect(() => {
    facingModeRef.current = facingMode;
  }, [facingMode]);

  const endCallRef = useRef<() => void>();

  // Monitor callState to handle transitions to idle after reject or end
  useEffect(() => {
    if (callState === "rejected" || callState === "ended") {
      const timer = setTimeout(() => {
        setCallState("idle");
        setRemoteUser(null);
        setCallId(null);
        setIsMuted(false);
        setCallDuration(0);
        setIsCameraOn(true);
        isCameraOnRef.current = true;
        setFacingMode("user");
        facingModeRef.current = "user";
        setIsInvite(false);
        setParticipants([]);
        setRemoteStreams(new Map());
        setParticipantsCameraOn(new Map());
        setParticipantsMuted(new Map());
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [callState]);

  // Monitor connected state to run duration timer
  useEffect(() => {
    if (callState === "connected") {
      setCallDuration(0);
      durationIntervalRef.current = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
        durationIntervalRef.current = null;
      }
    }
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current);
      }
    };
  }, [callState]);

  // Cleanup helper
  const cleanupCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    // Close all WebRTC peer connections
    peerConnectionsRef.current.forEach((pc) => {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    });
    peerConnectionsRef.current.clear();

    // Release all remote audio outputs
    remoteAudiosRef.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });
    remoteAudiosRef.current.clear();

    // Clear connection timeouts
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }

    // Clear disconnect recovery timeouts
    peerDisconnectTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    peerDisconnectTimeoutsRef.current.clear();

    setLocalStream(null);
    setRemoteStreams(new Map());
    setParticipants([]);
    setParticipantsCameraOn(new Map());
    setParticipantsMuted(new Map());
    iceCandidatesBuffersRef.current.clear();
    remoteOffersRef.current.clear();
    setIsInvite(false);
  };

  const removePeer = (targetUserId: string) => {
    const pc = peerConnectionsRef.current.get(targetUserId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peerConnectionsRef.current.delete(targetUserId);
    }

    const audioEl = remoteAudiosRef.current.get(targetUserId);
    if (audioEl) {
      audioEl.pause();
      audioEl.srcObject = null;
      remoteAudiosRef.current.delete(targetUserId);
    }

    const timeout = peerDisconnectTimeoutsRef.current.get(targetUserId);
    if (timeout) {
      clearTimeout(timeout);
      peerDisconnectTimeoutsRef.current.delete(targetUserId);
    }

    setRemoteStreams((prev) => {
      const next = new Map(prev);
      next.delete(targetUserId);
      return next;
    });

    setParticipants((prev) => prev.filter((p) => p.id !== targetUserId));
    setParticipantsCameraOn((prev) => {
      const next = new Map(prev);
      next.delete(targetUserId);
      return next;
    });
    setParticipantsMuted((prev) => {
      const next = new Map(prev);
      next.delete(targetUserId);
      return next;
    });

    // If no more participants remain, end the call
    if (peerConnectionsRef.current.size === 0) {
      cleanupCall();
      setCallState("ended");
    }
  };

  const createPeerConnection = (targetUserId: string, type: "audio" | "video") => {
    if (peerConnectionsRef.current.has(targetUserId)) {
      const oldPc = peerConnectionsRef.current.get(targetUserId);
      oldPc?.close();
    }

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionsRef.current.set(targetUserId, pc);

    // Add local tracks to connection
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current?.readyState === WebSocket.OPEN && callIdRef.current) {
        socketRef.current.send(
          JSON.stringify({
            type: "call_ice_candidate",
            targetUserIds: [targetUserId],
            payload: { callId: callIdRef.current, candidate: event.candidate }
          })
        );
      }
    };

    pc.ontrack = (event) => {
      const remoteStreamObj = event.streams[0];
      if (remoteStreamObj) {
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.set(targetUserId, remoteStreamObj);
          return next;
        });

        if (type === "audio") {
          let audioEl = remoteAudiosRef.current.get(targetUserId);
          if (!audioEl) {
            audioEl = new Audio();
            remoteAudiosRef.current.set(targetUserId, audioEl);
          }
          audioEl.srcObject = remoteStreamObj;
          audioEl.play().catch((e) => console.error(`Play failed for user ${targetUserId}:`, e));
        }
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`WebRTC connection state change for user ${targetUserId}:`, state);

      if (state === "connected") {
        const timeout = peerDisconnectTimeoutsRef.current.get(targetUserId);
        if (timeout) {
          clearTimeout(timeout);
          peerDisconnectTimeoutsRef.current.delete(targetUserId);
        }
        setCallState("connected");
      } else if (state === "failed" || state === "closed") {
        removePeer(targetUserId);
      } else if (state === "disconnected") {
        if (!peerDisconnectTimeoutsRef.current.has(targetUserId)) {
          const timeout = setTimeout(() => {
            console.warn(`WebRTC connection failed to recover for user ${targetUserId}`);
            removePeer(targetUserId);
          }, 10000);
          peerDisconnectTimeoutsRef.current.set(targetUserId, timeout);
        }
      }
    };

    return pc;
  };

  const startCall = async (targetUser: ChatSeed, type: "audio" | "video" = "audio") => {
    if (callState !== "idle") return;

    cleanupCall();
    const newCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    setCallId(newCallId);
    setRemoteUser(targetUser);
    setParticipants([targetUser]);
    setCallType(type);
    setCallState("outgoing");
    setIsMuted(false);
    setIsCameraOn(true);
    isCameraOnRef.current = true;
    setFacingMode("user");
    facingModeRef.current = "user";
    setCallDuration(0);

    try {
      const constraints = {
        audio: true,
        video: type === "video" ? { facingMode: "user" } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Create initial 1-to-1 WebRTC peer connection
      const pc = createPeerConnection(targetUser.id, type);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "call_offer",
            targetUserIds: [targetUser.id],
            payload: { callId: newCallId, sdp: offer, callType: type }
          })
        );
      } else {
        throw new Error("WebSocket not connected");
      }
    } catch (err) {
      console.error("Failed to start WebRTC call:", err);
      alert("Could not access camera or microphone. Please check permissions.");
      cleanupCall();
      setCallState("idle");
    }
  };

  const acceptCall = async () => {
    if (callState !== "incoming" || !callId || !remoteUser) return;

    setCallState("connecting");

    try {
      const constraints = {
        audio: true,
        video: callType === "video" ? { facingMode: "user" } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);

      const offer = remoteOffersRef.current.get(remoteUser.id);

      if (offer) {
        // Standard 1-to-1 setup (offer received with invite)
        const pc = createPeerConnection(remoteUser.id, callType);
        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        // Drain buffered candidates
        const buffer = iceCandidatesBuffersRef.current.get(remoteUser.id) || [];
        while (buffer.length > 0) {
          const cand = buffer.shift();
          if (cand) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch((e) =>
              console.error("Error applying buffered candidate:", e)
            );
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "call_answer",
              targetUserIds: [remoteUser.id],
              payload: { callId, sdp: answer }
            })
          );
          // Register in backend CallSession
          socketRef.current.send(
            JSON.stringify({
              type: "call_join",
              payload: { callId }
            })
          );
        } else {
          throw new Error("WebSocket disconnected");
        }
      } else {
        // Group invitation without initial offer (negotiation is peer-driven post-join)
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "call_join",
              payload: { callId }
            })
          );
        } else {
          throw new Error("WebSocket disconnected");
        }
      }
    } catch (err) {
      console.error("Failed to accept WebRTC call:", err);
      alert("Could not access camera or microphone. Please check permissions.");
      if (socketRef.current?.readyState === WebSocket.OPEN && remoteUser) {
        socketRef.current.send(
          JSON.stringify({
            type: "call_reject",
            targetUserIds: [remoteUser.id],
            payload: { callId }
          })
        );
      }
      cleanupCall();
      setCallState("idle");
    }
  };

  const rejectCall = () => {
    if (callStateRef.current !== "incoming" || !callIdRef.current || !remoteUserRef.current) return;

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "call_reject",
          targetUserIds: [remoteUserRef.current.id],
          payload: { callId: callIdRef.current }
        })
      );
    }
    cleanupCall();
    setCallState("rejected");
  };

  const endCall = () => {
    if (callStateRef.current === "idle") return;

    if (callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "call_end",
          payload: { callId: callIdRef.current }
        })
      );
    }
    cleanupCall();
    setCallState("ended");
  };

  useEffect(() => {
    endCallRef.current = endCall;
  });

  // Connection timeout handler
  useEffect(() => {
    if (callState === "outgoing" || callState === "incoming" || callState === "connecting") {
      if (!connectionTimeoutRef.current) {
        connectionTimeoutRef.current = setTimeout(() => {
          console.warn("WebRTC calling connection timeout reached");
          endCallRef.current?.();
        }, 30000);
      }
    } else {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
        connectionTimeoutRef.current = null;
      }
    }
    return () => {
      if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
      }
    };
  }, [callState]);

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        const nextMuted = !audioTrack.enabled;
        audioTrack.enabled = nextMuted;
        setIsMuted(!nextMuted);

        // Propagate mute state to all connections
        if (callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
          Array.from(peerConnectionsRef.current.keys()).forEach((peerId) => {
            socketRef.current!.send(
              JSON.stringify({
                type: "call_mic_toggle",
                targetUserIds: [peerId],
                payload: { callId: callIdRef.current, muted: !nextMuted }
              })
            );
          });
        }
      }
    }
  };

  const toggleCamera = async () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        const newEnabled = !videoTrack.enabled;

        if (newEnabled && videoTrack.readyState === "ended") {
          // Reacquire track if dead
          try {
            const constraints = {
              audio: false,
              video: { facingMode: facingModeRef.current }
            };
            const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newVideoTrack = tempStream.getVideoTracks()[0];
            if (!newVideoTrack) {
              throw new Error("No video track found in re-acquired stream");
            }

            localStreamRef.current.removeTrack(videoTrack);
            videoTrack.stop();
            localStreamRef.current.addTrack(newVideoTrack);

            // Replace tracks on all connections
            Array.from(peerConnectionsRef.current.entries()).forEach(([peerId, pc]) => {
              const senders = pc.getSenders();
              const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === "video" || (s.track === null && s.dtmf === null));
              if (videoSender) {
                videoSender.replaceTrack(newVideoTrack).catch((e: any) =>
                  console.error(`Failed replaceTrack for peer ${peerId}:`, e)
                );
              }
            });

            setIsCameraOn(true);
            isCameraOnRef.current = true;
            setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

            // Send camera toggled state to peers
            if (callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
              Array.from(peerConnectionsRef.current.keys()).forEach((peerId) => {
                socketRef.current!.send(
                  JSON.stringify({
                    type: "call_camera_toggle",
                    targetUserIds: [peerId],
                    payload: { callId: callIdRef.current, enabled: true }
                  })
                );
              });
            }
          } catch (err) {
            console.error("Failed to re-acquire camera track on toggle ON:", err);
          }
        } else {
          // Standard toggling
          videoTrack.enabled = newEnabled;
          setIsCameraOn(newEnabled);
          isCameraOnRef.current = newEnabled;

          if (callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
            Array.from(peerConnectionsRef.current.keys()).forEach((peerId) => {
              socketRef.current!.send(
                JSON.stringify({
                  type: "call_camera_toggle",
                  targetUserIds: [peerId],
                  payload: { callId: callIdRef.current, enabled: newEnabled }
                })
              );
            });
          }
        }
      } else if (isCameraOnRef.current === false) {
        // Fallback reacquisition if missing video track
        try {
          const constraints = {
            audio: false,
            video: { facingMode: facingModeRef.current }
          };
          const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
          const newVideoTrack = tempStream.getVideoTracks()[0];
          if (!newVideoTrack) {
            throw new Error("No video track found");
          }

          localStreamRef.current.addTrack(newVideoTrack);

          Array.from(peerConnectionsRef.current.entries()).forEach(([peerId, pc]) => {
            const senders = pc.getSenders();
            const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === "video" || (s.track === null && s.dtmf === null));
            if (videoSender) {
              videoSender.replaceTrack(newVideoTrack).catch((e: any) =>
                console.error(`Failed replaceTrack for peer ${peerId}:`, e)
              );
            }
          });

          setIsCameraOn(true);
          isCameraOnRef.current = true;
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

          if (callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
            Array.from(peerConnectionsRef.current.keys()).forEach((peerId) => {
              socketRef.current!.send(
                JSON.stringify({
                  type: "call_camera_toggle",
                  targetUserIds: [peerId],
                  payload: { callId: callIdRef.current, enabled: true }
                })
              );
            });
          }
        } catch (err) {
          console.error("Failed to re-acquire camera track ON (missing track fallback):", err);
        }
      }
    }
  };

  const switchCamera = async () => {
    if (callTypeRef.current !== "video" || !localStreamRef.current) return;

    const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
    const oldFacingMode = facingModeRef.current;
    const newFacingMode = oldFacingMode === "user" ? "environment" : "user";

    // Grab video senders for all connections
    const sendersMap = new Map<string, RTCRtpSender>();
    Array.from(peerConnectionsRef.current.entries()).forEach(([peerId, pc]) => {
      const senders = pc.getSenders();
      const videoSender = senders.find((s: RTCRtpSender) => s.track?.kind === "video" || (s.track === null && s.dtmf === null));
      if (videoSender) {
        sendersMap.set(peerId, videoSender);
      }
    });

    if (oldVideoTrack) {
      oldVideoTrack.stop();
      localStreamRef.current.removeTrack(oldVideoTrack);
    }

    try {
      let tempStream: MediaStream;
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: newFacingMode } },
          audio: false
        });
      } catch (e) {
        tempStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: newFacingMode },
          audio: false
        });
      }

      const newVideoTrack = tempStream.getVideoTracks()[0];
      if (!newVideoTrack || newVideoTrack.readyState !== "live") {
        throw new Error("Switched camera track is not live/usable");
      }

      // Replace track on all peer connection video senders
      for (const [peerId, videoSender] of Array.from(sendersMap.entries())) {
        await videoSender.replaceTrack(newVideoTrack).catch((e: any) =>
          console.error(`Failed replaceTrack on switch camera for peer ${peerId}:`, e)
        );
      }

      localStreamRef.current.addTrack(newVideoTrack);
      setFacingMode(newFacingMode);
      facingModeRef.current = newFacingMode;

      newVideoTrack.enabled = isCameraOnRef.current;
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      console.log("Switched camera successfully to facingMode:", newFacingMode);
    } catch (err) {
      console.error("Failed to switch camera, rollback:", err);
      try {
        const rollbackStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: oldFacingMode },
          audio: false
        });
        const rollbackTrack = rollbackStream.getVideoTracks()[0];
        if (rollbackTrack) {
          localStreamRef.current.addTrack(rollbackTrack);
          for (const videoSender of Array.from(sendersMap.values())) {
            await videoSender.replaceTrack(rollbackTrack);
          }
          rollbackTrack.enabled = isCameraOnRef.current;
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        }
      } catch (rollbackErr) {
        console.error("Failed rollback to old camera:", rollbackErr);
      }
    }
  };

  const inviteParticipant = (targetUserId: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN && callIdRef.current) {
      socketRef.current.send(
        JSON.stringify({
          type: "call_offer",
          targetUserIds: [targetUserId],
          payload: {
            callId: callIdRef.current,
            callType: callTypeRef.current,
            isInvite: true
          }
        })
      );
      console.log(`Sent call invitation to user: ${targetUserId} for session: ${callIdRef.current}`);
    }
  };

  const handleSignalingEvent = async (data: any) => {
    const eventType = data.type;
    const payload = data.payload || {};
    const msgCallId = payload.callId;
    const senderId = data.userId;

    if (!msgCallId) return;

    if (eventType === "call_offer") {
      const msgCallType = payload.callType || "audio";
      const isCurrentlyActive = callStateRef.current === "outgoing" || 
                                callStateRef.current === "incoming" || 
                                callStateRef.current === "connecting" || 
                                callStateRef.current === "connected";

      if (!isCurrentlyActive) {
        // Processing incoming call/invitation
        cleanupCall();
        const callerChat = directoryChats.find((c) => c.id === senderId) || {
          id: senderId,
          name: nameFromEmail(senderId),
          avatar: chatInitials(nameFromEmail(senderId)),
          color: "bg-[#0f766e]",
          preview: senderId,
          time: "",
          unread: 0,
          online: true
        };

        setCallId(msgCallId);
        setRemoteUser(callerChat);
        setParticipants([callerChat]);
        setCallType(msgCallType);
        setIsInvite(payload.isInvite || false);

        if (payload.sdp) {
          remoteOffersRef.current.set(senderId, payload.sdp);
        }

        setCallState("incoming");
        setIsMuted(false);
        setIsCameraOn(true);
        isCameraOnRef.current = true;
        setFacingMode("user");
        facingModeRef.current = "user";
        setCallDuration(0);
        iceCandidatesBuffersRef.current.set(senderId, []);
      } else {
        // Offer received while already active. Check if it matches our current call session ID.
        if (msgCallId === callIdRef.current) {
          if (payload.sdp) {
            const pc = peerConnectionsRef.current.get(senderId) || createPeerConnection(senderId, callTypeRef.current);
            await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));

            const buffer = iceCandidatesBuffersRef.current.get(senderId) || [];
            while (buffer.length > 0) {
              const cand = buffer.shift();
              if (cand) {
                await pc.addIceCandidate(new RTCIceCandidate(cand)).catch((e) =>
                  console.error("Error applying buffered candidate:", e)
                );
              }
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            if (socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(
                JSON.stringify({
                  type: "call_answer",
                  targetUserIds: [senderId],
                  payload: { callId: callIdRef.current, sdp: answer }
                })
              );
            }

            // Add peer to participants if missing
            const peerChat = directoryChats.find((chat) => chat.id === senderId) || {
              id: senderId,
              name: nameFromEmail(senderId),
              avatar: chatInitials(nameFromEmail(senderId)),
              color: "bg-[#0f766e]",
              preview: senderId,
              time: "",
              unread: 0,
              online: true
            };
            setParticipants((prev) => {
              if (prev.some((p) => p.id === senderId)) return prev;
              return [...prev, peerChat];
            });
          }
        } else {
          // Reject offer with busy status if we are already in another active call
          console.log(`Received call_offer for different session (${msgCallId}) while busy in (${callIdRef.current}). Rejecting.`);
          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(
              JSON.stringify({
                type: "call_reject",
                targetUserIds: [senderId],
                payload: { callId: msgCallId, reason: "busy" }
              })
            );
          }
        }
      }
    } else if (eventType === "call_answer") {
      if (callIdRef.current === msgCallId) {
        const pc = peerConnectionsRef.current.get(senderId);
        if (pc && payload.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
            .then(() => {
              setCallState("connecting");
              const buffer = iceCandidatesBuffersRef.current.get(senderId) || [];
              while (buffer.length > 0) {
                const cand = buffer.shift();
                if (cand) {
                  pc.addIceCandidate(new RTCIceCandidate(cand)).catch((e) =>
                    console.error("Error adding buffered candidate:", e)
                  );
                }
              }
            })
            .catch((e) => {
              console.error("Failed setRemoteDescription on answer:", e);
              removePeer(senderId);
            });
        }
      }
    } else if (eventType === "call_ice_candidate") {
      if (callIdRef.current === msgCallId) {
        const candidate = payload.candidate;
        const pc = peerConnectionsRef.current.get(senderId);
        if (pc && pc.remoteDescription) {
          pc.addIceCandidate(new RTCIceCandidate(candidate)).catch((e) =>
            console.error("Error adding ICE candidate:", e)
          );
        } else {
          let buffer = iceCandidatesBuffersRef.current.get(senderId);
          if (!buffer) {
            buffer = [];
            iceCandidatesBuffersRef.current.set(senderId, buffer);
          }
          buffer.push(candidate);
        }
      }
    } else if (eventType === "call_reject") {
      if (callIdRef.current === msgCallId) {
        if (payload.reason === "blocked") {
          alert("Cannot add user. One or more participants have blocked this user or are blocked by them.");
        } else if (payload.reason === "busy") {
          alert("User is busy on another call.");
        }
        if (callStateRef.current === "outgoing") {
          cleanupCall();
          setCallState("rejected");
        } else {
          removePeer(senderId);
        }
      }
    } else if (eventType === "call_end") {
      if (callIdRef.current === msgCallId) {
        removePeer(senderId);
      }
    } else if (eventType === "call_camera_toggle") {
      if (callIdRef.current === msgCallId) {
        setParticipantsCameraOn((prev) => {
          const next = new Map(prev);
          next.set(senderId, payload.enabled);
          return next;
        });
      }
    } else if (eventType === "call_mic_toggle") {
      if (callIdRef.current === msgCallId) {
        setParticipantsMuted((prev) => {
          const next = new Map(prev);
          next.set(senderId, payload.muted);
          return next;
        });
      }
    } else if (eventType === "call_participant_joined") {
      if (callIdRef.current === msgCallId) {
        const newUserId = payload.userId;
        const newParticipant = directoryChats.find((c) => c.id === newUserId) || {
          id: newUserId,
          name: nameFromEmail(newUserId),
          avatar: chatInitials(nameFromEmail(newUserId)),
          color: "bg-[#0f766e]",
          preview: newUserId,
          time: "",
          unread: 0,
          online: true
        };

        setParticipants((prev) => {
          if (prev.some((p) => p.id === newUserId)) return prev;
          return [...prev, newParticipant];
        });

        // Negotiate mesh: existing participants issue WebRTC offers to the newcomer
        if (!peerConnectionsRef.current.has(newUserId)) {
          const pc = createPeerConnection(newUserId, callTypeRef.current);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(
              JSON.stringify({
                type: "call_offer",
                targetUserIds: [newUserId],
                payload: { callId: callIdRef.current, sdp: offer, callType: callTypeRef.current }
              })
            );
          }
        }
      }
    } else if (eventType === "call_participant_left") {
      if (callIdRef.current === msgCallId) {
        removePeer(payload.userId || senderId);
      }
    } else if (eventType === "call_full") {
      if (callIdRef.current === msgCallId) {
        alert("Call is full (maximum 4 participants reached).");
        cleanupCall();
        setCallState("idle");
      }
    }
  };

  // Backward compatibility properties
  const firstParticipant = participants[0];
  const remoteStream = firstParticipant ? remoteStreams.get(firstParticipant.id) || null : null;
  const isRemoteCameraOn = firstParticipant ? participantsCameraOn.get(firstParticipant.id) ?? true : true;

  return {
    callState,
    callId,
    remoteUser,
    isMuted,
    callDuration,
    callType,
    isCameraOn,
    isRemoteCameraOn,
    localStream,
    remoteStream,
    facingMode,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    handleSignalingEvent,
    inviteParticipant,
    // Multi-peer group variables
    participants,
    remoteStreams,
    participantsCameraOn,
    participantsMuted
  };
}

function nameFromEmail(email?: string) {
  const localPart = (email ?? "").split("@")[0] ?? "";
  return (
    localPart
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "User"
  );
}

function CallAvatarImage({ alt, className, fallback, src }: { alt: string; className?: string; fallback: React.ReactNode; src: string }) {
  const [failedSrc, setFailedSrc] = useState("");

  useEffect(() => {
    setFailedSrc("");
  }, [src]);

  if (!src || failedSrc === src) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} className={className} onError={() => setFailedSrc(src)} src={src} />
  );
}

function chatInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "U"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

interface CallingVideoProps extends React.VideoHTMLAttributes<HTMLVideoElement> {
  stream: MediaStream | null;
}

const CallingVideo = React.memo(({ stream, ...props }: CallingVideoProps) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) {
        video.play().catch((e) => console.warn("Video play error:", e));
      }
    }
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline {...props} />;
});

CallingVideo.displayName = "CallingVideo";

interface AudioCallOverlayProps {
  callState: CallState;
  remoteUser: ChatSeed | null;
  isMuted: boolean;
  callDuration: number;
  callType: "audio" | "video";
  isCameraOn: boolean;
  isRemoteCameraOn: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  facingMode: "user" | "environment";
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;
  directoryChats: ChatSeed[];
  inviteParticipant: (userId: string) => void;
  participants?: ChatSeed[];
  remoteStreams?: Map<string, MediaStream>;
  participantsCameraOn?: Map<string, boolean>;
  participantsMuted?: Map<string, boolean>;
}

export function AudioCallOverlay({
  callState,
  remoteUser,
  isMuted,
  callDuration,
  callType,
  isCameraOn,
  isRemoteCameraOn,
  localStream,
  remoteStream,
  facingMode,
  acceptCall,
  rejectCall,
  endCall,
  toggleMute,
  toggleCamera,
  switchCamera,
  directoryChats,
  inviteParticipant,
  participants = [],
  remoteStreams = new Map(),
  participantsCameraOn = new Map(),
  participantsMuted = new Map()
}: AudioCallOverlayProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [mainVideo, setMainVideo] = useState<"remote" | "local">("remote");
  const [isAddPeopleOpen, setIsAddPeopleOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const firstRemoteStream = participants[0] ? remoteStreams.get(participants[0].id) || null : null;

  useEffect(() => {
    if (callState === "idle" || callState === "rejected" || callState === "ended") {
      setIsMinimized(false);
      setIsAddPeopleOpen(false);
      setMainVideo("remote");
    }
  }, [callState]);

  if (callState === "idle") return null;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const getStatusText = () => {
    switch (callState) {
      case "outgoing":
        return "Calling";
      case "connecting":
        return "Connecting";
      case "connected":
        return formatDuration(callDuration);
      case "rejected":
        return "Call Busy / Rejected";
      case "ended":
        return "Call Ended";
      default:
        return "";
    }
  };

  const isMobileDevice = () => {
    if (typeof navigator === "undefined") return false;
    return /Mobi|Android/i.test(navigator.userAgent);
  };

  const isMobile = isMobileDevice();

  const toggleSpeaker = async () => {
    const nextState = !isSpeakerOn;
    setIsSpeakerOn(nextState);
    console.log(`Speaker set to: ${nextState ? "loudspeaker" : "earpiece/default"}`);
  };

  const handleToggleUser = (userId: string) => {
    setSelectedUserIds((prev) => {
      if (prev.includes(userId)) {
        return prev.filter((id) => id !== userId);
      } else {
        // Enforce 4-participant cap (self + existing participants + selection cannot exceed 4)
        if (participants.length + 1 + prev.length >= 4) {
          alert("Maximum of 4 participants allowed in a call.");
          return prev;
        }
        return [...prev, userId];
      }
    });
  };

  const handleConfirmAddPeople = () => {
    selectedUserIds.forEach((userId) => {
      inviteParticipant(userId);
    });
    setIsAddPeopleOpen(false);
    setSelectedUserIds([]);
    setSearchQuery("");
  };

  const filteredUsers = directoryChats.filter((chat) => {
    const matchesSearch = chat.name.toLowerCase().includes(searchQuery.toLowerCase());
    // Filter out current active participants and self
    const isNotInCall = chat.id !== remoteUser?.id && !participants.some((p) => p.id === chat.id);
    return matchesSearch && isNotInCall;
  });

  const isGroupCall = participants.length > 1;

  // Incoming call banner
  if (callState === "incoming") {
    return (
      <div className="cs-scale-in fixed left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 top-4 z-[100] w-[calc(100vw-2rem)] md:w-full md:max-w-md rounded-3xl border border-white/10 bg-[#0E1726]/95 backdrop-blur-xl p-4 text-white shadow-[0_24px_60px_rgba(0,0,0,0.7)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl font-bold text-white text-base shadow-md ${
                remoteUser?.color || "bg-[#0B3B60]"
              }`}
            >
              {remoteUser?.avatarUrl ? (
                <CallAvatarImage alt={remoteUser.name} className="h-full w-full object-cover" fallback={remoteUser?.avatar || "U"} src={remoteUser.avatarUrl} />
              ) : (
                remoteUser?.avatar || "U"
              )}
            </span>
            <div className="min-w-0">
              <div className="truncate text-base font-bold text-[#E5E7EB]">{remoteUser?.name}</div>
              <div className="text-xs font-semibold text-[#38BDF8]">
                {participants.length > 0
                  ? (callType === "video" ? "Invited you to a group video call" : "Invited you to a group audio call")
                  : (callType === "video" ? "Incoming video call" : "Incoming audio call")}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              aria-label="Reject call"
              className="cs-press grid h-10 w-10 place-items-center rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors shadow-md"
              onClick={rejectCall}
              type="button"
            >
              <PhoneOff size={18} />
            </button>
            <button
              aria-label="Accept call"
              className="cs-press grid h-10 w-10 place-items-center rounded-full bg-gradient-to-r from-[#38BDF8] to-[#60A5FA] text-[#071019] shadow-md animate-pulse hover:brightness-110 transition-all font-bold"
              onClick={acceptCall}
              type="button"
            >
              <Phone size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Minimized call widget
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 right-4 z-[90] rounded-2xl bg-slate-900/95 border border-white/10 p-3 shadow-2xl flex items-center gap-3 text-white max-w-xs transition-all duration-300 w-72">
        <div className="relative h-12 w-12 rounded-xl overflow-hidden bg-slate-800 flex-shrink-0">
          {callType === "video" && isRemoteCameraOn && firstRemoteStream ? (
            <CallingVideo
              stream={firstRemoteStream}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className={`grid h-full w-full place-items-center text-sm font-black text-white ${remoteUser?.color || "bg-[#0f766e]"}`}>
              {remoteUser?.avatarUrl ? (
                <CallAvatarImage alt={remoteUser.name} className="h-full w-full object-cover" fallback={remoteUser?.avatar || "U"} src={remoteUser.avatarUrl} />
              ) : (
                remoteUser?.avatar || "U"
              )}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold">{remoteUser?.name}</div>
          <div className="text-[10px] text-slate-400 font-medium">{getStatusText()}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            aria-label="Maximize call"
            className="grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 text-white transition-colors"
            onClick={() => setIsMinimized(false)}
            type="button"
          >
            <ChevronUp size={16} />
          </button>
          <button
            aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
            className={`grid h-8 w-8 place-items-center rounded-lg hover:bg-white/10 transition-colors ${
              isMuted ? "text-red-500" : "text-white"
            }`}
            onClick={toggleMute}
            type="button"
          >
            {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          </button>
          <button
            aria-label="Hang up call"
            className="grid h-8 w-8 place-items-center rounded-lg bg-[#b42318] text-white hover:bg-[#911c13] transition-colors"
            onClick={endCall}
            type="button"
          >
            <PhoneOff size={14} />
          </button>
        </div>
      </div>
    );
  }

  // Active connected Video Interface
  if (callType === "video" && (callState === "connected" || callState === "connecting")) {
    return (
      <div className="fixed inset-0 z-[95] flex flex-col items-center justify-between text-white overflow-hidden bg-slate-950">
        
        {!isGroupCall ? (
          // WhatsApp 1-to-1 PIP Video Layout
          <>
            <div
              onClick={mainVideo === "local" ? () => setMainVideo("remote") : undefined}
              className={
                mainVideo === "remote"
                  ? "absolute inset-0 z-0 w-full h-full bg-slate-950 transition-all duration-300 overflow-hidden"
                  : "absolute top-24 right-4 h-36 w-28 rounded-2xl border-2 border-white/25 bg-slate-900 shadow-2xl z-20 flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-105 overflow-hidden"
              }
            >
              <CallingVideo
                stream={firstRemoteStream}
                className={`h-full w-full object-cover transition-opacity duration-300 ${
                  isRemoteCameraOn ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              />
              {!isRemoteCameraOn && (
                <div
                  style={{
                    backgroundImage: `radial-gradient(circle at center, #15323a 0%, #0b141a 100%), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M40 0l40 40-40 40L0 40z' fill='%23ffffff' fill-opacity='.008' fill-rule='evenodd'/%3E%3C/svg%3E")`
                  }}
                  className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b141a]"
                >
                  <span className={`grid place-items-center overflow-hidden rounded-full font-black text-white shadow-2xl border-2 border-slate-700/50 ${
                    mainVideo === "remote" ? "h-28 w-28 text-3xl" : "h-12 w-12 text-sm"
                  } ${remoteUser?.color || "bg-[#0f766e]"}`}>
                    {remoteUser?.avatarUrl ? (
                      <CallAvatarImage alt={remoteUser.name} className="h-full w-full object-cover" fallback={remoteUser?.avatar || "U"} src={remoteUser.avatarUrl} />
                    ) : (
                      remoteUser?.avatar || "U"
                    )}
                  </span>
                  {mainVideo === "remote" && (
                    <>
                      <h4 className="mt-5 text-xl font-bold truncate max-w-[240px]">{remoteUser?.name}</h4>
                      <p className="text-sm text-slate-400 mt-1">Camera is off</p>
                    </>
                  )}
                </div>
              )}
            </div>

            <div
              onClick={mainVideo === "remote" ? () => setMainVideo("local") : undefined}
              className={
                mainVideo === "local"
                  ? "absolute inset-0 z-0 w-full h-full bg-slate-950 transition-all duration-300 overflow-hidden"
                  : "absolute top-24 right-4 h-36 w-28 rounded-2xl border-2 border-white/25 bg-slate-900 shadow-2xl z-20 flex items-center justify-center cursor-pointer transition-all duration-300 hover:scale-105 overflow-hidden"
              }
            >
              <CallingVideo
                stream={localStream}
                muted
                className={`h-full w-full object-cover scale-x-[-1] transition-opacity duration-300 ${
                  isCameraOn ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              />
              {!isCameraOn && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-800 text-white">
                  <span className="text-xs font-bold">You</span>
                </div>
              )}
            </div>
          </>
        ) : (
          // Group Video Call Responsive Grid Layout (3+ Participants)
          <div className="z-10 w-full flex-1 px-4 py-24 flex items-center justify-center">
            <div className="grid grid-cols-2 gap-3 w-full max-w-2xl aspect-video md:aspect-auto md:max-h-[60vh] h-full">
              {/* Local Participant Tile */}
              <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-white/10 flex items-center justify-center aspect-square md:aspect-auto h-full">
                <CallingVideo
                  stream={localStream}
                  muted
                  className={`h-full w-full object-cover scale-x-[-1] transition-opacity duration-300 ${
                    isCameraOn ? "opacity-100" : "opacity-0 pointer-events-none"
                  }`}
                />
                {!isCameraOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800">
                    <span className="h-16 w-16 rounded-full bg-slate-700 flex items-center justify-center text-xl font-bold border border-white/10 shadow-md">
                      You
                    </span>
                    <span className="text-xs text-slate-400 mt-2">You (Camera off)</span>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-white/5">
                  <span>You</span>
                  {isMuted && <MicOff size={12} className="text-red-500" />}
                </div>
              </div>

              {/* Remote Participants Tiles */}
              {participants.map((p) => {
                const stream = remoteStreams.get(p.id) || null;
                const pCameraOn = participantsCameraOn.get(p.id) ?? true;
                const pMuted = participantsMuted.get(p.id) ?? false;

                return (
                  <div key={p.id} className="relative rounded-2xl overflow-hidden bg-slate-900 border border-white/10 flex items-center justify-center aspect-square md:aspect-auto h-full">
                    {stream && (
                      <CallingVideo
                        stream={stream}
                        className={`h-full w-full object-cover transition-opacity duration-300 ${
                          pCameraOn ? "opacity-100" : "opacity-0 pointer-events-none"
                        }`}
                      />
                    )}
                    {(!stream || !pCameraOn) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-800">
                        <span className={`grid h-16 w-16 place-items-center rounded-full text-xl font-black text-white border border-slate-700/50 shadow-md ${p.color}`}>
                          {p.avatar}
                        </span>
                        <span className="text-xs text-slate-400 mt-2">{p.name} {(!pCameraOn) ? "(Camera off)" : ""}</span>
                      </div>
                    )}
                    <div className="absolute bottom-2 left-2 bg-black/40 backdrop-blur-md px-2 py-0.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-white/5">
                      <span className="truncate max-w-[100px]">{p.name}</span>
                      {pMuted && <MicOff size={12} className="text-red-500" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Header navigation and details */}
        <div className="z-30 w-full px-6 pt-6 flex justify-between items-center bg-gradient-to-b from-black/50 to-transparent pb-12">
          <button
            aria-label="Minimize call"
            className="cs-press grid h-12 w-12 place-items-center rounded-full bg-black/30 backdrop-blur-md border border-white/10 text-white hover:bg-black/50 transition-colors"
            onClick={() => setIsMinimized(true)}
            type="button"
          >
            <ChevronLeft size={24} />
          </button>
          
          <div className="text-center text-white drop-shadow-md">
            <h3 className="truncate text-lg font-bold max-w-[180px] md:max-w-xs">
              {isGroupCall ? "Group Call" : remoteUser?.name}
            </h3>
            <p className="text-xs text-slate-300 mt-0.5 tracking-wider font-medium">{getStatusText()}</p>
          </div>

          <div className="w-12 h-12" />
        </div>

        {/* Bottom controls panel (WhatsApp-style 2-Row layout for Video calls) */}
        <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-t-[40px] md:rounded-[32px] p-6 pb-8 z-30 mt-auto flex flex-col gap-6 shadow-[0_-12px_40px_rgba(0,0,0,0.6)]">
          {/* Row 1: Add People | Speaker | Camera */}
          <div className="grid grid-cols-3 gap-4 w-full max-w-sm mx-auto justify-items-center">
            {/* Add People */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                aria-label="Add people"
                className="cs-press grid h-12 w-12 place-items-center rounded-full bg-slate-800 hover:bg-slate-700 text-white border border-white/5"
                onClick={() => setIsAddPeopleOpen(true)}
                type="button"
              >
                <UserPlus size={20} />
              </button>
              <span className="text-[10px] text-slate-400 font-semibold">Add People</span>
            </div>

            {/* Speaker Toggle */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                aria-label={isSpeakerOn ? "Speaker" : "Earpiece"}
                className={`cs-press grid h-12 w-12 place-items-center rounded-full border transition-all ${
                  isSpeakerOn
                    ? "bg-white text-slate-950 border-white"
                    : "bg-slate-800 hover:bg-slate-700 text-white border-white/5"
                }`}
                onClick={toggleSpeaker}
                type="button"
              >
                <Volume2 size={20} />
              </button>
              <span className="text-[10px] text-slate-400 font-semibold">{isSpeakerOn ? "Speaker" : "Earpiece"}</span>
            </div>

            {/* Camera Toggle */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                aria-label={isCameraOn ? "Turn camera off" : "Turn camera on"}
                className={`cs-press grid h-12 w-12 place-items-center rounded-full border transition-all ${
                  isCameraOn
                    ? "bg-slate-800 hover:bg-slate-700 text-white border-white/5"
                    : "bg-white text-slate-950 border-white"
                }`}
                onClick={toggleCamera}
                type="button"
              >
                {isCameraOn ? <Video size={20} /> : <VideoOff size={20} />}
              </button>
              <span className="text-[10px] text-slate-400 font-semibold">{isCameraOn ? "Camera On" : "Camera Off"}</span>
            </div>
          </div>

          {/* Row 2: Mute | Switch Camera (mobile only) | End Call */}
          <div className={`grid ${isMobile ? 'grid-cols-3' : 'grid-cols-2'} gap-4 w-full max-w-sm mx-auto justify-items-center`}>
            {/* Mute */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                className={`cs-press grid h-12 w-12 place-items-center rounded-full border transition-all ${
                  isMuted
                    ? "bg-white text-slate-950 border-white"
                    : "bg-slate-800 hover:bg-slate-700 text-white border-white/5"
                }`}
                onClick={toggleMute}
                type="button"
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <span className="text-[10px] text-slate-400 font-semibold">{isMuted ? "Muted" : "Mute"}</span>
            </div>

            {/* Switch camera (mobile only) */}
            {isMobile && (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  aria-label="Switch camera"
                  className="cs-press grid h-12 w-12 place-items-center rounded-full bg-slate-800 hover:bg-slate-700 text-white border border-white/5"
                  onClick={switchCamera}
                  type="button"
                >
                  <RotateCw size={20} />
                </button>
                <span className="text-[10px] text-slate-400 font-semibold">Switch</span>
              </div>
            )}

            {/* End Call */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                aria-label="End call"
                className="cs-press grid h-12 w-12 place-items-center rounded-full bg-[#b42318] hover:bg-[#911c13] text-white"
                onClick={endCall}
                type="button"
              >
                <PhoneOff size={20} />
              </button>
              <span className="text-[10px] text-[#b42318] font-bold">End</span>
            </div>
          </div>
        </div>

        {/* Add People Selection Modal */}
        {isAddPeopleOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-3xl bg-slate-900 border border-white/10 p-6 text-white shadow-2xl flex flex-col max-h-[80vh] cs-scale-in">
              <h3 className="text-lg font-bold mb-4">Add people</h3>
              
              <input
                type="text"
                placeholder="Search users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-[#00a884] mb-4"
              />

              <div className="flex-1 overflow-y-auto mb-6 pr-1 space-y-2 max-h-[40vh]">
                {filteredUsers.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-4">No users found</p>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelected = selectedUserIds.includes(user.id);
                    return (
                      <div
                        key={user.id}
                        onClick={() => handleToggleUser(user.id)}
                        className="flex items-center justify-between p-2 rounded-xl hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`grid h-9 w-9 place-items-center rounded-xl font-bold text-white text-xs ${user.color}`}>
                            {user.avatar}
                          </span>
                          <span className="text-sm font-semibold truncate max-w-[160px]">{user.name}</span>
                        </div>
                        <div className={`h-5 w-5 rounded-full border flex items-center justify-center transition-colors ${
                          isSelected ? "border-[#00a884] bg-[#00a884]" : "border-slate-500"
                        }`}>
                          {isSelected && (
                            <span className="block h-2 w-2 rounded-full bg-white" />
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex justify-end gap-3 mt-auto border-t border-white/5 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddPeopleOpen(false);
                    setSelectedUserIds([]);
                    setSearchQuery("");
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAddPeople}
                  disabled={selectedUserIds.length === 0}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold text-white transition-colors ${
                    selectedUserIds.length === 0 ? "bg-slate-800 text-slate-500 cursor-not-allowed" : "bg-[#00a884] hover:bg-[#008f70]"
                  }`}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // Active connected Audio Interface
  return (
    <div
      style={{
        backgroundImage: `radial-gradient(circle at center, #152035 0%, #071019 100%), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M40 0l40 40-40 40L0 40z' fill='%23ffffff' fill-opacity='.008' fill-rule='evenodd'/%3E%3C/svg%3E")`
      }}
      className="fixed inset-0 z-[95] flex flex-col items-center justify-between text-[#E5E7EB] overflow-hidden bg-[#071019] transition-all duration-300"
    >
      {/* Top Header bar */}
      <div className="z-30 w-full px-6 pt-6 flex justify-between items-center bg-gradient-to-b from-black/40 to-transparent pb-10">
        <button
          aria-label="Minimize call"
          className="cs-press grid h-12 w-12 place-items-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-[#E5E7EB] hover:bg-white/20 transition-colors"
          onClick={() => setIsMinimized(true)}
          type="button"
        >
          <ChevronLeft size={24} />
        </button>

        <div className="w-12 h-12" />
      </div>

      {/* Centered User Info & Avatar Grid */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 w-full -mt-12 max-w-2xl">
        {!isGroupCall ? (
          // WhatsApp 1-to-1 centered avatar
          <div className="flex flex-col items-center justify-center w-full">
            <div className="relative flex items-center justify-center my-6">
              {(callState === "outgoing" || callState === "connecting") && (
                <>
                  <div className="absolute h-40 w-40 animate-ping rounded-full bg-[#38BDF8]/20" />
                  <div className="absolute h-36 w-36 animate-pulse rounded-full bg-[#38BDF8]/30" />
                </>
              )}
              {callState === "connected" && (
                <div className="absolute h-36 w-36 animate-pulse rounded-full bg-[#38BDF8]/15" />
              )}
              <span
                className={`relative z-10 grid h-28 w-28 md:h-32 md:w-32 place-items-center overflow-hidden rounded-full text-4xl font-black text-white shadow-2xl border-4 border-[#38BDF8]/30 ${
                  remoteUser?.color || "bg-[#0B3B60]"
                }`}
              >
                {remoteUser?.avatarUrl ? (
                  <CallAvatarImage alt={remoteUser.name} className="h-full w-full object-cover" fallback={remoteUser?.avatar || "U"} src={remoteUser.avatarUrl} />
                ) : (
                  remoteUser?.avatar || "U"
                )}
              </span>
            </div>

            <h2 className="truncate text-2xl md:text-3xl font-bold text-[#E5E7EB] text-center w-full">{remoteUser?.name}</h2>
            <p className="mt-2 text-sm font-bold text-[#38BDF8] uppercase tracking-wider">{getStatusText()}</p>
          </div>
        ) : (
          // Group Audio Avatar Grid (3+ Participants)
          <div className="w-full flex flex-col items-center">
            <div className="grid grid-cols-2 gap-4 w-full max-w-md my-6">
              {/* Local Participant avatar */}
              <div className="flex flex-col items-center justify-center p-4 bg-[#152035]/60 rounded-3xl border border-white/10 relative">
                <span className="grid h-20 w-20 place-items-center rounded-full text-2xl font-black text-white bg-[#0B3B60] shadow-md border-2 border-[#38BDF8]/30">
                  You
                </span>
                <span className="text-sm font-bold text-[#E5E7EB] mt-3">You</span>
                <span className="text-xs text-[#9AA3B8] mt-1">
                  {isMuted ? "Muted" : "Active"}
                </span>
              </div>

              {/* Remote Participants Avatars */}
              {participants.map((p) => {
                const pMuted = participantsMuted.get(p.id) ?? false;
                return (
                  <div key={p.id} className="flex flex-col items-center justify-center p-4 bg-[#152035]/60 rounded-3xl border border-white/10 relative">
                    <span className={`grid h-20 w-20 place-items-center rounded-full text-2xl font-black text-white shadow-md border-2 border-white/10 ${p.color}`}>
                      {p.avatar}
                    </span>
                    <span className="text-sm font-bold text-[#E5E7EB] mt-3 truncate max-w-[120px]">{p.name}</span>
                    <span className="text-xs text-[#9AA3B8] mt-1">
                      {pMuted ? "Muted" : "Active"}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-sm font-bold text-[#38BDF8] uppercase tracking-wider">{getStatusText()}</p>
          </div>
        )}
      </div>

      {/* Large Dark Controls Panel at bottom */}
      <div className="w-full max-w-md bg-[#0E1726]/95 backdrop-blur-xl border border-white/10 rounded-t-[40px] md:rounded-[32px] p-8 pb-10 shadow-[0_-12px_40px_rgba(0,0,0,0.7)] flex flex-col gap-6">
        {/* Row 1: Add People | Speaker | Mute */}
        <div className="grid grid-cols-3 gap-4 w-full max-w-sm mx-auto justify-items-center">
          {/* Add People */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label="Add people"
              className="cs-press grid h-14 w-14 place-items-center rounded-full bg-[#152035] hover:bg-[#1f2d47] text-[#E5E7EB] transition-colors border border-white/10"
              onClick={() => setIsAddPeopleOpen(true)}
              type="button"
            >
              <UserPlus size={24} />
            </button>
            <span className="text-xs text-[#9AA3B8] font-semibold">Add People</span>
          </div>

          {/* Speaker Toggle */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label={isSpeakerOn ? "Speaker" : "Earpiece"}
              className={`cs-press grid h-14 w-14 place-items-center rounded-full border transition-all ${
                isSpeakerOn
                  ? "bg-white text-[#071019] border-white"
                  : "bg-[#152035] hover:bg-[#1f2d47] text-[#E5E7EB] border-white/10"
              }`}
              onClick={toggleSpeaker}
              type="button"
            >
              <Volume2 size={24} />
            </button>
            <span className="text-xs text-[#9AA3B8] font-semibold">{isSpeakerOn ? "Speaker" : "Earpiece"}</span>
          </div>

          {/* Mute Button */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
              className={`cs-press grid h-14 w-14 place-items-center rounded-full border transition-all ${
                isMuted
                  ? "bg-white text-[#071019] border-white"
                  : "bg-[#152035] hover:bg-[#1f2d47] text-[#E5E7EB] border-white/10"
              }`}
              onClick={toggleMute}
              type="button"
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <span className="text-xs text-[#9AA3B8] font-semibold">{isMuted ? "Muted" : "Mute"}</span>
          </div>
        </div>

        {/* Row 2: Center End Call Button */}
        <div className="grid grid-cols-3 gap-4 w-full max-w-sm mx-auto justify-items-center">
          <div />
          
          {/* End Call Button */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label="End call"
              className="cs-press grid h-14 w-14 place-items-center rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors shadow-lg"
              onClick={endCall}
              type="button"
            >
              <PhoneOff size={24} />
            </button>
            <span className="text-xs text-red-400 font-bold">End</span>
          </div>

          <div />
        </div>
      </div>

      {/* Add People Selection Modal */}
      {isAddPeopleOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-3xl bg-[#0E1726] border border-white/10 p-6 text-[#E5E7EB] shadow-2xl flex flex-col max-h-[80vh] cs-scale-in">
            <h3 className="text-lg font-bold mb-4">Add people</h3>
            
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#152035]/70 border border-white/10 rounded-xl px-3 py-2 text-sm text-[#E5E7EB] placeholder-[#64748B] focus:outline-none focus:border-[#38BDF8] mb-4"
            />

            <div className="flex-1 overflow-y-auto mb-6 pr-1 space-y-2 max-h-[40vh]">
              {filteredUsers.length === 0 ? (
                <p className="text-xs text-[#9AA3B8] text-center py-4">No users found</p>
              ) : (
                filteredUsers.map((user) => {
                  const isSelected = selectedUserIds.includes(user.id);
                  return (
                    <div
                      key={user.id}
                      onClick={() => handleToggleUser(user.id)}
                      className="flex items-center justify-between p-2 rounded-xl hover:bg-white/[0.06] cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`grid h-9 w-9 place-items-center rounded-xl font-bold text-white text-xs ${user.color}`}>
                          {user.avatar}
                        </span>
                        <span className="text-sm font-semibold truncate max-w-[160px]">{user.name}</span>
                      </div>
                      <div className={`h-5 w-5 rounded-full border flex items-center justify-center transition-colors ${
                        isSelected ? "border-[#38BDF8] bg-[#38BDF8]" : "border-slate-600"
                      }`}>
                        {isSelected && (
                          <span className="block h-2 w-2 rounded-full bg-[#071019]" />
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex justify-end gap-3 mt-auto border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => {
                  setIsAddPeopleOpen(false);
                  setSelectedUserIds([]);
                  setSearchQuery("");
                }}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-[#9AA3B8] hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAddPeople}
                disabled={selectedUserIds.length === 0}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                  selectedUserIds.length === 0 ? "bg-white/5 text-[#64748B] cursor-not-allowed" : "bg-gradient-to-r from-[#38BDF8] to-[#60A5FA] text-[#071019]"
                }`}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
