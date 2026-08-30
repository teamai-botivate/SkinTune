import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recommendationsRouter from "./recommendations";
import generateImageRouter from "./generate-image";
import refineImageRouter from "./refine-image";
import analyzePhotoRouter from "./analyze-photo";
import searchDressesRouter from "./search-dresses";
import tryOnRouter from "./try-on";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recommendationsRouter);
router.use(generateImageRouter);
router.use(refineImageRouter);
router.use(analyzePhotoRouter);
// real-dress-search branch: replaces the AI-generated-look flow with real
// web-sourced dresses + a gpt-image-2 try-on — see CLAUDE.md.
router.use(searchDressesRouter);
router.use(tryOnRouter);

export default router;
