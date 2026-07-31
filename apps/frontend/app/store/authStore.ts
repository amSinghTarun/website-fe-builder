import { create } from "zustand";

interface User {
  username: string;
}

interface AuthStore {
  user: User | null;
  initialized: boolean;
  login: (user: User) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  initialized: false,
  login: (user: User) =>
    set({
      user: user,
      initialized: true,
    }),
}));
