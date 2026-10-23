import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Amity Exams",
    short_name: "Exams",
    description: "Personal exam planner and AI study helper",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2443c4",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
