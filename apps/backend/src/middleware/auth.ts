import { verifyJwt } from "../helpers";
import { type FastifyRequest, type HookHandlerDoneFunction } from "fastify";

export const checkAuth = async (request: FastifyRequest) => {
  try {
    let token = request.cookies.token;

    console.log("Cookie token", token);

    if (!token)
      throw new Error(
        "Authorization header mission or not properply formatted",
      );

    const { username, userId } = verifyJwt(token);

    request.username = username;
    request.userId = userId;
  } catch (error) {
    throw error;
  }
};
