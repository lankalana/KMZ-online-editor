import { createRoot } from "react-dom/client";
import { Application } from "./ui/Application";

const root = document.getElementById("root");
if (!root) throw new Error("Missing React root element.");

createRoot(root).render(<Application />);
