import jwt from "jsonwebtoken";
import "dotenv/config";

export const createJwt = (userId: string): string =>
  jwt.sign({ userId: userId }, process.env.JWT_SECRET!, {
    expiresIn: Date.now() + 1000 * 60 * 60 * 720,
  });

export const verifyJwt = (token: string): { userId: string } => {
  try {
    let paylaod = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: number;
    };
    return { userId: paylaod.userId.toString() };
  } catch (error: any) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error("Session Expired, login again");
    }
    return error;
  }
};
