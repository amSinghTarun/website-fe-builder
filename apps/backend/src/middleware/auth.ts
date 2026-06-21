import { verifyJwt } from "../helpers";
import { type FastifyRequest, type HookHandlerDoneFunction } from "fastify";

export const checkAuth = async (
  request: FastifyRequest,
  done: HookHandlerDoneFunction,
) => {
  try {
    let token = request.headers.authorization?.split("Bearer ")[1];

    if (!token)
      throw new Error(
        "Authorization header mission or nor properply formatted",
      );

    const { userId } = verifyJwt(token);

    request.userId = userId;

    done();
  } catch (error: any) {
    done(error as Error);
  }
};
