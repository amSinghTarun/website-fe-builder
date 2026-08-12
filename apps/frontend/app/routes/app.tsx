import { App } from "../components/App";
import { ProtectedRoute } from "./ProtectedRoute";

export default function MyRouteComponent() {
  return (
    <ProtectedRoute>
      <App />
    </ProtectedRoute>
  );
}
