import { type RouteConfig, index, route } from "@react-router/dev/routes";
// import { flatRoutes } from "@react-router/fs-routes";

export default [
  // renders into the root.tsx Outlet at /
  index("./routes/landing.tsx"),
  // route("/", "./routes/landing.tsx"),

  route("/app", "./routes/app.tsx"),

  // ...(await flatRoutes()),
] satisfies RouteConfig;
