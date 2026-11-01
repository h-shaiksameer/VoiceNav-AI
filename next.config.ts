import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    MAP_TILE_URL: process.env.MAP_TILE_URL,
  },
};

export default config;