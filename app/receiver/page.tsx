import type { Metadata } from "next";
import Receiver from "@/components/Receiver";

export const metadata: Metadata = {
  title: "Receiver · Voice-to-Map",
  description: "The shared map at the command post: every call sign in a session, live, with a replay.",
};

export default function ReceiverPage() {
  return <Receiver />;
}
