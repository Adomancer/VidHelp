import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a phone on the same Wi-Fi open the dev server by the laptop's IP.
  allowedDevOrigins: ["192.168.0.100"],
};

export default nextConfig;
