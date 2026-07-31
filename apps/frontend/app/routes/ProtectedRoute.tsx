import { Navigate } from "react-router";
import { useAuthStore } from "../store/authStore";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const initialized = useAuthStore((state) => state.initialized);

  if (!initialized)
    return <div className="bg-[#070707] h-screen w-screen">Loading...</div>;

  if (!user)
    return <Navigate to="/" replace />;

  return children;
}