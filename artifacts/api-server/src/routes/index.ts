import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recommendationsRouter from "./recommendations";
import generateImagesRouter from "./generate-images";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recommendationsRouter);
router.use(generateImagesRouter);

export default router;
