import { apiUrl } from "../config";

export const loginUser = async () => {
  const response = await fetch(apiUrl("/signup"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      username: "",
      password: "password",
    }),
  });

  console.log(response);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "Login failed");
  }

  return response.json();
};
