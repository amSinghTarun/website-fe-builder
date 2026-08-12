import { verifyJwt } from "../helpers";
import { type FastifyRequest } from "fastify";

function unauthorized(): Error & { statusCode: number } {
  return Object.assign(new Error("Authentication required"), {
    statusCode: 401,
  });
}

export const checkAuth = async (request: FastifyRequest) => {
  const token = request.cookies.token;

  if (!token) throw unauthorized();

  try {
    const { username, userId } = verifyJwt(token);

    request.username = username;
    request.userId = userId;
  } catch {
    throw unauthorized();
  }
};
