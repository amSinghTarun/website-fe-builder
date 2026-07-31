import jwt, { type JwtPayload } from "jsonwebtoken";
import "dotenv/config";

export const createJwt = (username: string, userId: number): string =>
  jwt.sign({ username: username, userId: userId }, process.env.JWT_SECRET!, {
    expiresIn: Date.now() + 1000 * 60 * 60 * 720,
  });

export const verifyJwt = (
  token: string,
): { username: string; userId: number } => {
  try {
    let paylaod = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    return { username: paylaod.username.toString(), userId: paylaod.userId };
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Session Expired, login again");
    }
    return error;
  }
};
