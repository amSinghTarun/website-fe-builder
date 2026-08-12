import jwt, { type JwtPayload } from "jsonwebtoken";
import "dotenv/config";

export const createJwt = (username: string, userId: number): string =>
  jwt.sign({ username: username, userId: userId }, process.env.JWT_SECRET!, {
    expiresIn: "30d",
  });

export const verifyJwt = (
  token: string,
): { username: string; userId: number } => {
  const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
  return { username: payload.username.toString(), userId: payload.userId };
};
