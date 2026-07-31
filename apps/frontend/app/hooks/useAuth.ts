import { loginUser } from "../functions/auth";
import { useAuthStore } from "../store/authStore";
import { useState } from "react";
import { toast } from "sonner";

export function useAuth() {
  const loginStore = useAuthStore((state) => state.login);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    try {
      setLoading(true);
      const userLoggedIn = await loginUser();

      console.log(userLoggedIn);

      loginStore({ username: userLoggedIn.body.username });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return {
    login,
    loading,
  };
}
