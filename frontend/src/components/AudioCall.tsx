"use client";

import React, { useState, useEffect, useRef } from "react";
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff, RotateCw } from "lucide-react";
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

  // Phase 2 video states
  const [callType, setCallType] = useState<"audio" | "video">("audio");
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isRemoteCameraOn, setIsRemoteCameraOn] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const iceCandidatesBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const durationIntervalRef = useRef<any>(null);
  const remoteOfferRef = useRef<any>(null);

  // Connection timeout for outgoing/incoming/connecting states (30s)
  const connectionTimeoutRef = useRef<any>(null);
  // Recovery timeout for WebRTC temporary disconnects (10s)
  const disconnectTimeoutRef = useRef<any>(null);

  // Safe references to prevent stale closures in event handlers
  const callStateRef = useRef<CallState>("idle");
  const callIdRef = useRef<string | null>(null);
  const remoteUserRef = useRef<ChatSeed | null>(null);
  const callTypeRef = useRef<"audio" | "video">("audio");

  useEffect(() => {
    callStateRef.current = callState;
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

  // Stable reference to endCall to be called inside setTimeout callbacks safely
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
        setLocalStream(null);
        setRemoteStream(null);
        setIsCameraOn(true);
        setIsRemoteCameraOn(true);
        setFacingMode("user");
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

  // Helper to cleanup all WebRTC elements and timers
  const cleanupCall = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.onconnectionstatechange = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (disconnectTimeoutRef.current) {
      clearTimeout(disconnectTimeoutRef.current);
      disconnectTimeoutRef.current = null;
    }
    setLocalStream(null);
    setRemoteStream(null);
    iceCandidatesBufferRef.current = [];
    remoteOfferRef.current = null;
  };

  const startCall = async (targetUser: ChatSeed, type: "audio" | "video" = "audio") => {
    if (callState !== "idle") return;

    cleanupCall();
    const newCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    setCallId(newCallId);
    setRemoteUser(targetUser);
    setCallType(type);
    setCallState("outgoing");
    setIsMuted(false);
    setIsCameraOn(true);
    setIsRemoteCameraOn(true);
    setFacingMode("user");
    setCallDuration(0);

    try {
      const constraints = {
        audio: true,
        video: type === "video" ? { facingMode: "user" } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "call_ice_candidate",
              targetUserIds: [targetUser.id],
              payload: { callId: newCallId, candidate: event.candidate }
            })
          );
        }
      };

      pc.ontrack = (event) => {
        const remoteStreamObj = event.streams[0];
        if (remoteStreamObj) {
          setRemoteStream(remoteStreamObj);
          // For audio-only calls, play remote audio using dynamic Audio element to preserve existing behavior
          if (type === "audio") {
            if (!remoteAudioRef.current) {
              remoteAudioRef.current = new Audio();
            }
            remoteAudioRef.current.srcObject = remoteStreamObj;
            remoteAudioRef.current.play().catch((e) => console.error("Play failed", e));
          }
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log("WebRTC connection state change:", state);

        if (state === "connected") {
          if (disconnectTimeoutRef.current) {
            clearTimeout(disconnectTimeoutRef.current);
            disconnectTimeoutRef.current = null;
          }
          setCallState("connected");
        } else if (state === "failed" || state === "closed") {
          if (disconnectTimeoutRef.current) {
            clearTimeout(disconnectTimeoutRef.current);
            disconnectTimeoutRef.current = null;
          }
          endCallRef.current?.();
        } else if (state === "disconnected") {
          if (!disconnectTimeoutRef.current) {
            disconnectTimeoutRef.current = setTimeout(() => {
              console.warn("WebRTC connection failed to recover from disconnected state");
              endCallRef.current?.();
            }, 10000); // 10s recovery window
          }
        }
      };

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
    if (callState !== "incoming" || !callId || !remoteUser || !remoteOfferRef.current) return;

    setCallState("connecting");

    try {
      const constraints = {
        audio: true,
        video: callType === "video" ? { facingMode: "user" } : false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      setLocalStream(stream);

      const pc = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "call_ice_candidate",
              targetUserIds: [remoteUser.id],
              payload: { callId, candidate: event.candidate }
            })
          );
        }
      };

      pc.ontrack = (event) => {
        const remoteStreamObj = event.streams[0];
        if (remoteStreamObj) {
          setRemoteStream(remoteStreamObj);
          // For audio-only calls, play remote audio using dynamic Audio element to preserve existing behavior
          if (callType === "audio") {
            if (!remoteAudioRef.current) {
              remoteAudioRef.current = new Audio();
            }
            remoteAudioRef.current.srcObject = remoteStreamObj;
            remoteAudioRef.current.play().catch((e) => console.error("Play failed", e));
          }
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log("WebRTC connection state change:", state);

        if (state === "connected") {
          if (disconnectTimeoutRef.current) {
            clearTimeout(disconnectTimeoutRef.current);
            disconnectTimeoutRef.current = null;
          }
          setCallState("connected");
        } else if (state === "failed" || state === "closed") {
          if (disconnectTimeoutRef.current) {
            clearTimeout(disconnectTimeoutRef.current);
            disconnectTimeoutRef.current = null;
          }
          endCallRef.current?.();
        } else if (state === "disconnected") {
          if (!disconnectTimeoutRef.current) {
            disconnectTimeoutRef.current = setTimeout(() => {
              console.warn("WebRTC connection failed to recover from disconnected state");
              endCallRef.current?.();
            }, 10000); // 10s recovery window
          }
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(remoteOfferRef.current));

      // Apply any buffered candidates
      while (iceCandidatesBufferRef.current.length > 0) {
        const cand = iceCandidatesBufferRef.current.shift();
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
      } else {
        throw new Error("WebSocket disconnected");
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

    if (remoteUserRef.current && callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "call_end",
          targetUserIds: [remoteUserRef.current.id],
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

  // Monitor callState to handle connection timeout (30 seconds)
  useEffect(() => {
    if (callState === "outgoing" || callState === "incoming" || callState === "connecting") {
      if (!connectionTimeoutRef.current) {
        connectionTimeoutRef.current = setTimeout(() => {
          console.warn("WebRTC calling connection timeout reached");
          endCallRef.current?.();
        }, 30000); // 30s timeout
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
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle local camera (disable/enable video track and propagate update to peer)
  const toggleCamera = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsCameraOn(videoTrack.enabled);

        if (remoteUserRef.current && callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "call_camera_toggle",
              targetUserIds: [remoteUserRef.current.id],
              payload: { callId: callIdRef.current, enabled: videoTrack.enabled }
            })
          );
        }
      }
    }
  };

  // Switch camera on mobile using RTCRtpSender.replaceTrack()
  const switchCamera = async () => {
    if (callTypeRef.current !== "video" || !localStreamRef.current || !peerConnectionRef.current) return;

    const newFacingMode = facingMode === "user" ? "environment" : "user";
    try {
      const newConstraints = {
        audio: false,
        video: { facingMode: newFacingMode }
      };
      const tempStream = await navigator.mediaDevices.getUserMedia(newConstraints);
      const newVideoTrack = tempStream.getVideoTracks()[0];

      if (!newVideoTrack) {
        throw new Error("No video track found in switched camera stream");
      }

      // Stop old video track
      const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.stop();
        localStreamRef.current.removeTrack(oldVideoTrack);
      }

      // Add new video track to local stream
      localStreamRef.current.addTrack(newVideoTrack);
      setFacingMode(newFacingMode);

      // Re-apply local camera toggle state
      newVideoTrack.enabled = isCameraOn;

      // Replace track on the RTCRtpSender
      const senders = peerConnectionRef.current.getSenders();
      const videoSender = senders.find((s) => s.track?.kind === "video");
      if (videoSender) {
        await videoSender.replaceTrack(newVideoTrack);
        console.log("Replaced video track on RTCRtpSender successfully");
      }

      // Update localStream state to force UI redraw
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    } catch (err) {
      console.error("Failed to switch camera:", err);
    }
  };

  const handleSignalingEvent = (data: any) => {
    const eventType = data.type;
    const payload = data.payload || {};
    const msgCallId = payload.callId;
    const senderId = data.userId;

    if (!msgCallId) return;

    if (eventType === "call_offer") {
      const msgCallType = payload.callType || "audio";
      if (callStateRef.current !== "idle") {
        // Automatically reject if busy
        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "call_reject",
              targetUserIds: [senderId],
              payload: { callId: msgCallId, reason: "busy" }
            })
          );
        }
        return;
      }

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
      setCallType(msgCallType);
      remoteOfferRef.current = payload.sdp;
      setCallState("incoming");
      setIsMuted(false);
      setIsCameraOn(true);
      setIsRemoteCameraOn(true);
      setFacingMode("user");
      setCallDuration(0);
      iceCandidatesBufferRef.current = [];
    } else if (eventType === "call_answer") {
      if (callIdRef.current === msgCallId && callStateRef.current === "outgoing" && peerConnectionRef.current) {
        peerConnectionRef.current
          .setRemoteDescription(new RTCSessionDescription(payload.sdp))
          .then(() => {
            setCallState("connecting");
            while (iceCandidatesBufferRef.current.length > 0) {
              const cand = iceCandidatesBufferRef.current.shift();
              if (cand) {
                peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(cand)).catch((e) =>
                  console.error("Error adding buffered candidate:", e)
                );
              }
            }
          })
          .catch((e) => {
            console.error("Failed setRemoteDescription on answer:", e);
            cleanupCall();
            setCallState("ended");
          });
      }
    } else if (eventType === "call_ice_candidate") {
      if (callIdRef.current === msgCallId) {
        const candidate = payload.candidate;
        if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
          peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch((e) =>
            console.error("Error adding ICE candidate:", e)
          );
        } else {
          iceCandidatesBufferRef.current.push(candidate);
        }
      }
    } else if (eventType === "call_reject") {
      if (callIdRef.current === msgCallId) {
        cleanupCall();
        setCallState("rejected");
      }
    } else if (eventType === "call_end") {
      if (callIdRef.current === msgCallId) {
        cleanupCall();
        setCallState("ended");
      }
    } else if (eventType === "call_camera_toggle") {
      if (callIdRef.current === msgCallId) {
        setIsRemoteCameraOn(payload.enabled);
      }
    }
  };

  return {
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
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    handleSignalingEvent
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

function chatInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "U"}${parts[1]?.[0] ?? ""}`.toUpperCase();
}

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
  switchCamera
}: AudioCallOverlayProps) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (callState === "idle") return null;

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const getStatusText = () => {
    switch (callState) {
      case "outgoing":
        return "Calling...";
      case "connecting":
        return "Connecting...";
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

  if (callState === "incoming") {
    // Responsive, non-overflowing banner for incoming calls (designed to fit on 320px screens)
    return (
      <div className="cs-scale-in fixed left-1/2 top-4 z-[100] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-3xl border border-[#dce1e8] bg-white p-3 sm:p-4 shadow-[0_24px_60px_rgba(15,23,42,.16)]">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl font-black text-white text-sm ${
                remoteUser?.color || "bg-[#0f766e]"
              }`}
            >
              {remoteUser?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={remoteUser.name} className="h-full w-full object-cover" src={remoteUser.avatarUrl} />
              ) : (
                remoteUser?.avatar || "U"
              )}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm sm:text-base font-bold text-[#18212f]">{remoteUser?.name}</div>
              <div className="text-[10px] sm:text-xs font-semibold text-[#00a884]">
                {callType === "video" ? "Incoming video call" : "Incoming audio call"}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              aria-label="Reject call"
              className="cs-press grid h-10 w-10 place-items-center rounded-xl bg-[#b42318] text-white hover:bg-[#911c13]"
              onClick={rejectCall}
              type="button"
            >
              <PhoneOff size={18} />
            </button>
            <button
              aria-label="Accept call"
              className="cs-press grid h-10 w-10 place-items-center rounded-xl bg-[#00a884] text-white hover:bg-[#008f70]"
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

  // Render Video Layout for active connected video calls
  if (callType === "video" && (callState === "connected" || callState === "connecting")) {
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-[#0f172a]/60 px-4 backdrop-blur-sm">
        <div className="cs-scale-in flex w-full max-w-sm h-[75vh] max-h-[calc(100vh-2rem)] overflow-hidden flex-col items-center rounded-3xl border border-[#dce1e8] bg-slate-950 text-center shadow-[0_28px_90px_rgba(15,23,42,.22)] relative">
          
          {/* Main Area: Remote Video */}
          <div className="absolute inset-0 z-0 bg-slate-950 rounded-3xl overflow-hidden">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`h-full w-full object-cover transition-opacity duration-300 ${
                isRemoteCameraOn ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            />
            {/* Remote Avatar Placeholder */}
            {!isRemoteCameraOn && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-white">
                <span className={`grid h-20 w-20 place-items-center overflow-hidden rounded-full text-2xl font-black text-white ${remoteUser?.color || "bg-[#0f766e]"}`}>
                  {remoteUser?.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={remoteUser.name} className="h-full w-full object-cover" src={remoteUser.avatarUrl} />
                  ) : (
                    remoteUser?.avatar || "U"
                  )}
                </span>
                <h4 className="mt-4 text-lg font-bold truncate max-w-[200px]">{remoteUser?.name}</h4>
                <p className="text-xs text-slate-400 mt-1">Camera is turned off</p>
              </div>
            )}
          </div>

          {/* Small Overlay: Local Video (Muted to prevent echo feedback, mirrored) */}
          <div className="absolute top-4 right-4 h-28 w-20 rounded-2xl border border-white/20 bg-slate-900 shadow-md overflow-hidden z-10 flex items-center justify-center">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
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

          {/* Controls overlay */}
          <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col items-center z-20">
            <div className="text-white mb-4 text-center">
              <h4 className="text-sm font-bold truncate max-w-[240px]">{remoteUser?.name}</h4>
              <p className="text-xs text-slate-300 mt-0.5">{getStatusText()}</p>
            </div>
            
            <div className="flex items-center gap-3 justify-center">
              {/* Mic mute */}
              <button
                aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                className={`cs-press grid h-10 w-10 place-items-center rounded-full border transition-colors ${
                  isMuted
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-white/20 bg-white/10 backdrop-blur-md text-white hover:bg-white/20"
                }`}
                onClick={toggleMute}
                type="button"
              >
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>

              {/* Camera toggle */}
              <button
                aria-label={isCameraOn ? "Turn camera off" : "Turn camera on"}
                className={`cs-press grid h-10 w-10 place-items-center rounded-full border transition-colors ${
                  !isCameraOn
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-white/20 bg-white/10 backdrop-blur-md text-white hover:bg-white/20"
                }`}
                onClick={toggleCamera}
                type="button"
              >
                {isCameraOn ? <Video size={18} /> : <VideoOff size={18} />}
              </button>

              {/* Switch camera (mobile only) */}
              {isMobileDevice() && (
                <button
                  aria-label="Switch camera"
                  className="cs-press grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white hover:bg-white/20"
                  onClick={switchCamera}
                  type="button"
                >
                  <RotateCw size={18} />
                </button>
              )}

              {/* Hang up */}
              <button
                aria-label="Hang up call"
                className="cs-press grid h-12 w-12 place-items-center rounded-full bg-[#b42318] text-white hover:bg-[#911c13]"
                onClick={endCall}
                type="button"
              >
                <PhoneOff size={20} />
              </button>
            </div>
          </div>

        </div>
      </div>
    );
  }

  // Centered overlay modal for audio calls, and video calls in outgoing/connecting/ended states
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#0f172a]/60 px-4 backdrop-blur-sm">
      <div className="cs-scale-in flex w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto flex-col items-center rounded-3xl border border-[#dce1e8] bg-white p-8 text-center shadow-[0_28px_90px_rgba(15,23,42,.22)]">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">
          {callType === "video" ? "Video Call" : "Audio Call"}
        </p>

        {/* Pulse effect avatar */}
        <div className="relative my-8 flex items-center justify-center">
          {(callState === "outgoing" || callState === "connecting") && (
            <>
              <div className="absolute h-28 w-28 animate-ping rounded-full bg-[#00a884]/20" />
              <div className="absolute h-24 w-24 animate-pulse rounded-full bg-[#00a884]/30" />
            </>
          )}
          {callState === "connected" && <div className="absolute h-24 w-24 animate-pulse rounded-full bg-[#00a884]/15" />}
          <span
            className={`relative z-10 grid h-20 w-20 place-items-center overflow-hidden rounded-full text-2xl font-black text-white ${
              remoteUser?.color || "bg-[#0f766e]"
            }`}
          >
            {remoteUser?.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt={remoteUser.name} className="h-full w-full object-cover" src={remoteUser.avatarUrl} />
            ) : (
              remoteUser?.avatar || "U"
            )}
          </span>
        </div>

        <h3 className="truncate text-2xl font-black text-[#18212f]">{remoteUser?.name}</h3>
        <p className="mt-2 text-sm font-semibold text-[#64748b]">{getStatusText()}</p>

        {/* Control buttons */}
        <div className="mt-8 flex items-center gap-6 justify-center">
          {callState === "connected" && (
            <button
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
              className={`cs-press grid h-12 w-12 place-items-center rounded-full border transition-colors ${
                isMuted
                  ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                  : "border-[#dce1e8] bg-white text-[#64748b] hover:bg-[#f1f5f9]"
              }`}
              onClick={toggleMute}
              type="button"
            >
              {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>
          )}
          <button
            aria-label="Hang up call"
            className="cs-press grid h-14 w-14 place-items-center rounded-full bg-[#b42318] text-white hover:bg-[#911c13]"
            onClick={endCall}
            type="button"
          >
            <PhoneOff size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
