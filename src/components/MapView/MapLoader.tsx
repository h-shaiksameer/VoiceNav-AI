"use client";

import dynamic from "next/dynamic";
import { LoaderCircle } from "lucide-react";

const MapLoader = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map-loading"><LoaderCircle size={26} className="spin" /><span>Loading map</span></div> });
export default MapLoader;