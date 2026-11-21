import type { Metadata } from "next";
import CommandPost from "@/components/CommandPost";

export const metadata: Metadata = {
  title: "Command post · Voice-to-Map",
  description: "The shared map at the command post: every call sign and track in a mission, live, with a replay. Tracks can be placed and changed here by hand.",
};

export default function CommandPostPage() {
  return <CommandPost />;
}
