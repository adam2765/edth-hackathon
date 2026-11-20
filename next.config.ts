import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo runs `next dev` on the Mac, and the badge sat on the receiver's Live button.
  // Compile and runtime errors still show.
  devIndicators: false,
};

export default nextConfig;
