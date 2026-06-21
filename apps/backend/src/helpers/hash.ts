import argon from "argon2";

export const hashPassword = async (password: string): Promise<string> =>
  await argon.hash(password);

export const verifyHashedPassword = async (
  digest: string,
  password: string,
): Promise<boolean> => await argon.verify(digest, password);
