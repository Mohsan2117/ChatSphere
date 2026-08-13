"use client";

import React, { useState, useEffect, useRef } from "react";
import { Phone, PhoneOff, Mic, MicOff } from "lucide-react";
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

  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const iceCandidatesBufferRef = useRef<RTCIceCandidateInit[]>([]);
  const durationIntervalRef = useRef<any>(null);
  const remoteOfferRef = useRef<any>(null);

  // Monitor callState to handle transitions to idle after reject or end
  useEffect(() => {
    if (callState === "rejected" || callState === "ended") {
      const timer = setTimeout(() => {
        setCallState("idle");
        setRemoteUser(null);
        setCallId(null);
        setIsMuted(false);
        setCallDuration(0);
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

  // Helper to cleanup all WebRTC elements
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
    iceCandidatesBufferRef.current = [];
    remoteOfferRef.current = null;
  };

  const startCall = async (targetUser: ChatSeed) => {
    if (callState !== "idle") return;

    cleanupCall();
    const newCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    setCallId(newCallId);
    setRemoteUser(targetUser);
    setCallState("outgoing");
    setIsMuted(false);
    setCallDuration(0);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

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
        const remoteStream = event.streams[0];
        if (remoteStream) {
          if (!remoteAudioRef.current) {
            remoteAudioRef.current = new Audio();
          }
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch((e) => console.error("Play failed", e));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCallState("connected");
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          cleanupCall();
          setCallState("ended");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: "call_offer",
            targetUserIds: [targetUser.id],
            payload: { callId: newCallId, sdp: offer }
          })
        );
      } else {
        throw new Error("WebSocket not connected");
      }
    } catch (err) {
      console.error("Failed to start WebRTC call:", err);
      alert("Could not access microphone or initiate WebRTC stream.");
      cleanupCall();
      setCallState("idle");
    }
  };

  const acceptCall = async () => {
    if (callState !== "incoming" || !callId || !remoteUser || !remoteOfferRef.current) return;

    setCallState("connecting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

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
        const remoteStream = event.streams[0];
        if (remoteStream) {
          if (!remoteAudioRef.current) {
            remoteAudioRef.current = new Audio();
          }
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch((e) => console.error("Play failed", e));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCallState("connected");
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          cleanupCall();
          setCallState("ended");
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
      alert("Could not access microphone or connect WebRTC audio.");
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
    if (callState !== "incoming" || !callId || !remoteUser) return;

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "call_reject",
          targetUserIds: [remoteUser.id],
          payload: { callId }
        })
      );
    }
    cleanupCall();
    setCallState("rejected");
  };

  const endCall = () => {
    if (callState === "idle") return;

    if (remoteUser && callId && socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: "call_end",
          targetUserIds: [remoteUser.id],
          payload: { callId }
        })
      );
    }
    cleanupCall();
    setCallState("ended");
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const handleSignalingEvent = (data: any) => {
    const eventType = data.type;
    const payload = data.payload || {};
    const msgCallId = payload.callId;
    const senderId = data.userId;

    if (!msgCallId) return;

    if (eventType === "call_offer") {
      if (callState !== "idle") {
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
      remoteOfferRef.current = payload.sdp;
      setCallState("incoming");
      setIsMuted(false);
      setCallDuration(0);
      iceCandidatesBufferRef.current = [];
    } else if (eventType === "call_answer") {
      if (callId === msgCallId && callState === "outgoing" && peerConnectionRef.current) {
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
      if (callId === msgCallId) {
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
      if (callId === msgCallId) {
        cleanupCall();
        setCallState("rejected");
      }
    } else if (eventType === "call_end") {
      if (callId === msgCallId) {
        cleanupCall();
        setCallState("ended");
      }
    }
  };

  return {
    callState,
    remoteUser,
    isMuted,
    callDuration,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
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
  acceptCall: () => void;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
}

export function AudioCallOverlay({
  callState,
  remoteUser,
  isMuted,
  callDuration,
  acceptCall,
  rejectCall,
  endCall,
  toggleMute
}: AudioCallOverlayProps) {
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

  if (callState === "incoming") {
    // Elegant floating non-backdrop alert banner for incoming calls
    return (
      <div className="cs-scale-in fixed left-1/2 top-6 z-[100] w-[90%] max-w-sm -translate-x-1/2 rounded-3xl border border-[#dce1e8] bg-white p-4 shadow-[0_24px_60px_rgba(15,23,42,.16)]">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className={`grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl font-black text-white ${
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
              <div className="truncate text-base font-bold text-[#18212f]">{remoteUser?.name}</div>
              <div className="text-xs font-semibold text-[#00a884]">Incoming audio call</div>
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

  // Centered overlay modal for outgoing, active, and term status calls
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#0f172a]/60 px-4 backdrop-blur-sm">
      <div className="cs-scale-in flex w-full max-w-sm flex-col items-center rounded-3xl border border-[#dce1e8] bg-white p-8 text-center shadow-[0_28px_90px_rgba(15,23,42,.22)]">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-[#00a884]">Audio Call</p>

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
