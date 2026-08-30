import { ClusterTopology } from "../components/ClusterTopology";
import { ProtectedRoute } from "./ProtectedRoute";

export default function ClusterRoute() {
  return (
    <ProtectedRoute>
      <ClusterTopology />
    </ProtectedRoute>
  );
}
