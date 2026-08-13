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
  Volume2,
  MoreHorizontal,
  Share2
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
  const isCameraOnRef = useRef<boolean>(true);

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

  useEffect(() => {
    isCameraOnRef.current = isCameraOn;
  }, [isCameraOn]);

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
        isCameraOnRef.current = true;
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
    isCameraOnRef.current = true;
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
        const newEnabled = !videoTrack.enabled;
        videoTrack.enabled = newEnabled;
        setIsCameraOn(newEnabled);
        isCameraOnRef.current = newEnabled;

        if (remoteUserRef.current && callIdRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(
            JSON.stringify({
              type: "call_camera_toggle",
              targetUserIds: [remoteUserRef.current.id],
              payload: { callId: callIdRef.current, enabled: newEnabled }
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
      newVideoTrack.enabled = isCameraOnRef.current;

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
      isCameraOnRef.current = true;
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
  const [isMinimized, setIsMinimized] = useState(false);
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

  // Reset minimized state when a call session transitions out of active states
  useEffect(() => {
    if (callState === "idle" || callState === "rejected" || callState === "ended") {
      setIsMinimized(false);
    }
  }, [callState]);

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

  // Rendering for incoming call banner
  if (callState === "incoming") {
    return (
      <div className="cs-scale-in fixed left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 top-4 z-[100] w-[calc(100vw-2rem)] md:w-full md:max-w-md rounded-3xl border border-white/10 bg-slate-900/95 backdrop-blur-md p-4 text-white shadow-[0_24px_60px_rgba(0,0,0,0.6)]">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl font-black text-white text-base shadow-md ${
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
              <div className="truncate text-base font-bold text-white">{remoteUser?.name}</div>
              <div className="text-xs font-semibold text-[#00a884]">
                {callType === "video" ? "Incoming video call" : "Incoming audio call"}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              aria-label="Reject call"
              className="cs-press grid h-10 w-10 place-items-center rounded-full bg-[#b42318] text-white hover:bg-[#911c13] transition-colors shadow-md"
              onClick={rejectCall}
              type="button"
            >
              <PhoneOff size={18} />
            </button>
            <button
              aria-label="Accept call"
              className="cs-press grid h-10 w-10 place-items-center rounded-full bg-[#00a884] text-white hover:bg-[#008f70] transition-colors shadow-md animate-pulse"
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

  // Rendering for minimized calling widget
  if (isMinimized) {
    return (
      <div className="fixed bottom-20 right-4 z-[90] rounded-2xl bg-slate-900/95 border border-white/10 p-3 shadow-2xl flex items-center gap-3 text-white max-w-xs transition-all duration-300 w-72">
        <div className="relative h-12 w-12 rounded-xl overflow-hidden bg-slate-800 flex-shrink-0">
          {callType === "video" && isRemoteCameraOn && remoteStream ? (
            <video
              ref={(el) => {
                if (el) el.srcObject = remoteStream;
              }}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
          ) : (
            <span className={`grid h-full w-full place-items-center text-sm font-black text-white ${remoteUser?.color || "bg-[#0f766e]"}`}>
              {remoteUser?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={remoteUser.name} className="h-full w-full object-cover" src={remoteUser.avatarUrl} />
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

  // Render Video Layout for active connected video calls (fill-screen viewport)
  if (callType === "video" && (callState === "connected" || callState === "connecting")) {
    return (
      <div className="fixed inset-0 z-[95] flex flex-col items-center justify-between text-white overflow-hidden bg-slate-950">
        
        {/* Remote video area (full viewport) */}
        <div className="absolute inset-0 z-0 h-full w-full bg-slate-950">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className={`h-full w-full object-cover transition-opacity duration-500 ${
              isRemoteCameraOn ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          />
          {/* Avatar display if remote camera is disabled */}
          {!isRemoteCameraOn && (
            <div
              style={{
                backgroundImage: `radial-gradient(circle at center, #15323a 0%, #0b141a 100%), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M40 0l40 40-40 40L0 40z' fill='%23ffffff' fill-opacity='.008' fill-rule='evenodd'/%3E%3C/svg%3E")`
              }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b141a]"
            >
              <span className={`grid h-28 w-28 place-items-center overflow-hidden rounded-full text-3xl font-black text-white shadow-2xl border-4 border-slate-700/50 ${remoteUser?.color || "bg-[#0f766e]"}`}>
                {remoteUser?.avatarUrl ? (
                  <img alt={remoteUser.name} className="h-full w-full object-cover" src={remoteUser.avatarUrl} />
                ) : (
                  remoteUser?.avatar || "U"
                )}
              </span>
              <h4 className="mt-5 text-xl font-bold truncate max-w-[240px]">{remoteUser?.name}</h4>
              <p className="text-sm text-slate-400 mt-1">Camera is off</p>
            </div>
          )}
        </div>

        {/* Local Video floating PIP (top-right, mirrored, constrained to safe boundaries) */}
        <div className="absolute top-24 right-4 h-36 w-28 rounded-2xl border-2 border-white/25 bg-slate-900 shadow-2xl overflow-hidden z-20 flex items-center justify-center">
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
            <h3 className="truncate text-lg font-bold max-w-[180px] md:max-w-xs">{remoteUser?.name}</h3>
            <p className="text-xs text-slate-300 mt-0.5 tracking-wider font-medium">{getStatusText()}</p>
          </div>

          {/* Symmetrical Header Spacer (Add People was moved to bottom drawer controls) */}
          <div className="w-12 h-12" />
        </div>

        {/* Bottom controls panel (WhatsApp-style 2-Row layout for Video calls) */}
        <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-t-[40px] md:rounded-[32px] p-6 pb-8 z-30 mt-auto flex flex-col gap-6 shadow-[0_-12px_40px_rgba(0,0,0,0.6)]">
          {/* Row 1: Add People | Camera Toggle | Speaker */}
          <div className="grid grid-cols-3 gap-4 w-full max-w-sm mx-auto justify-items-center">
            {/* Add People */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                aria-label="Add people"
                disabled
                className="grid h-12 w-12 place-items-center rounded-full bg-white/5 border border-white/5 text-white/20 cursor-not-allowed"
                type="button"
              >
                <UserPlus size={20} />
              </button>
              <span className="text-[10px] text-slate-400 font-semibold">Add People</span>
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

            {/* Speaker (UI Only) */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                aria-label="Speaker"
                className="cs-press grid h-12 w-12 place-items-center rounded-full bg-slate-800 hover:bg-slate-700 text-white border border-white/5"
                onClick={() => {}}
                type="button"
              >
                <Volume2 size={20} />
              </button>
              <span className="text-[10px] text-slate-400 font-semibold">Speaker</span>
            </div>
          </div>

          {/* Row 2: Mic Mute | Switch Camera (mobile only) | End Call */}
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

      </div>
    );
  }

  // Render Full Screen Audio Call Interface (also used for video calls in outgoing/connecting/ended states)
  return (
    <div
      style={{
        backgroundImage: `radial-gradient(circle at center, #15323a 0%, #0b141a 100%), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cpath d='M40 0l40 40-40 40L0 40z' fill='%23ffffff' fill-opacity='.008' fill-rule='evenodd'/%3E%3C/svg%3E")`
      }}
      className="fixed inset-0 z-[95] flex flex-col items-center justify-between text-white overflow-hidden bg-[#0b141a] transition-all duration-300"
    >
      {/* Top Header bar */}
      <div className="z-30 w-full px-6 pt-6 flex justify-between items-center bg-gradient-to-b from-black/30 to-transparent pb-10">
        <button
          aria-label="Minimize call"
          className="cs-press grid h-12 w-12 place-items-center rounded-full bg-white/10 backdrop-blur-md border border-white/10 text-white hover:bg-white/20 transition-colors"
          onClick={() => setIsMinimized(true)}
          type="button"
        >
          <ChevronLeft size={24} />
        </button>

        <button
          aria-label="Add participant"
          disabled
          className="grid h-12 w-12 place-items-center rounded-full bg-white/5 border border-white/5 text-white/20 cursor-not-allowed"
          type="button"
        >
          <UserPlus size={20} />
        </button>
      </div>

      {/* Centered User Info & Avatar */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 max-w-sm w-full -mt-12">
        <div className="relative flex items-center justify-center my-6">
          {(callState === "outgoing" || callState === "connecting") && (
            <>
              <div className="absolute h-40 w-40 animate-ping rounded-full bg-[#00a884]/15" />
              <div className="absolute h-36 w-36 animate-pulse rounded-full bg-[#00a884]/20" />
            </>
          )}
          {callState === "connected" && (
            <div className="absolute h-36 w-36 animate-pulse rounded-full bg-[#00a884]/10" />
          )}
          <span
            className={`relative z-10 grid h-28 w-28 md:h-32 md:w-32 place-items-center overflow-hidden rounded-full text-4xl font-black text-white shadow-2xl border-4 border-slate-700/50 ${
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

        <h2 className="truncate text-2xl md:text-3xl font-black text-white text-center w-full">{remoteUser?.name}</h2>
        <p className="mt-2 text-sm font-semibold text-[#00a884] uppercase tracking-wider">{getStatusText()}</p>
      </div>

      {/* Large Dark Controls Panel at bottom */}
      <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-md border border-white/10 rounded-t-[40px] md:rounded-[32px] p-8 pb-10 shadow-[0_-12px_40px_rgba(0,0,0,0.6)]">
        <div className="grid grid-cols-3 gap-y-6 gap-x-4 justify-items-center">
          {/* Speaker Button */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label="Speaker volume"
              className="cs-press grid h-14 w-14 place-items-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-colors border border-white/5"
              onClick={() => {}}
              type="button"
            >
              <Volume2 size={24} />
            </button>
            <span className="text-xs text-slate-400 font-semibold">Speaker</span>
          </div>

          {/* Video Button (Disabled/unavailable in audio mode) */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label="Switch to video call"
              disabled
              className="grid h-14 w-14 place-items-center rounded-full bg-slate-800/30 text-white/20 cursor-not-allowed border border-white/5"
              type="button"
            >
              <Video size={24} />
            </button>
            <span className="text-xs text-slate-500 font-semibold">Video</span>
          </div>

          {/* Mute Button */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
              className={`cs-press grid h-14 w-14 place-items-center rounded-full border transition-all ${
                isMuted
                  ? "bg-white text-slate-950 border-white"
                  : "bg-slate-800 hover:bg-slate-700 text-white border-white/5"
              }`}
              onClick={toggleMute}
              type="button"
            >
              {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
            </button>
            <span className="text-xs text-slate-400 font-semibold">{isMuted ? "Muted" : "Mute"}</span>
          </div>

          {/* More options Button */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label="More options"
              className="cs-press grid h-14 w-14 place-items-center rounded-full bg-slate-800 hover:bg-slate-700 text-white transition-colors border border-white/5"
              onClick={() => {}}
              type="button"
            >
              <MoreHorizontal size={24} />
            </button>
            <span className="text-xs text-slate-400 font-semibold">More</span>
          </div>

          {/* Share Button (Disabled) */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label="Share call"
              disabled
              className="grid h-14 w-14 place-items-center rounded-full bg-slate-800/30 text-white/20 cursor-not-allowed border border-white/5"
              type="button"
            >
              <Share2 size={24} />
            </button>
            <span className="text-xs text-slate-500 font-semibold">Share</span>
          </div>

          {/* End Call Button (Visually prominent red circular background) */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              aria-label="End call"
              className="cs-press grid h-14 w-14 place-items-center rounded-full bg-[#b42318] hover:bg-[#911c13] text-white transition-colors"
              onClick={endCall}
              type="button"
            >
              <PhoneOff size={24} />
            </button>
            <span className="text-xs text-[#b42318] font-bold">End</span>
          </div>
        </div>
      </div>

    </div>
  );
}
