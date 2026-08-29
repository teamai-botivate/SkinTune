import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recommendationsRouter from "./recommendations";
import generateImageRouter from "./generate-image";
import refineImageRouter from "./refine-image";
import analyzePhotoRouter from "./analyze-photo";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recommendationsRouter);
router.use(generateImageRouter);
router.use(refineImageRouter);
router.use(analyzePhotoRouter);

export default router;
