import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo runs `next dev` on the Mac, and the badge sat on the command post's Live button.
  // Compile and runtime errors still show.
  devIndicators: false,
  // The command post was called the receiver, at /receiver. Old links and bookmarks still work;
  // the query (?session=…) goes along. Temporary, so a browser does not keep it for ever.
  async redirects() {
    return [{ source: "/receiver", destination: "/cp", permanent: false }];
  },
};

export default nextConfig;
