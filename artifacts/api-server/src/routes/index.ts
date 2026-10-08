import { Router, type IRouter } from "express";
import healthRouter from "./health";
import recommendationsRouter from "./recommendations";
import generateImageRouter from "./generate-image";
import refineImageRouter from "./refine-image";
import analyzePhotoRouter from "./analyze-photo";
import productRecommendationsRouter from "./product-recommendations";
import searchDressesRouter from "./search-dresses";
import tryOnRouter from "./try-on";
import avatarRouter from "./avatar";
import productFeedbackRouter from "./product-feedback";

const router: IRouter = Router();

router.use(healthRouter);
router.use(recommendationsRouter);
router.use(generateImageRouter);
router.use(refineImageRouter);
router.use(analyzePhotoRouter);
router.use(productRecommendationsRouter);
router.use(searchDressesRouter);
router.use(tryOnRouter);
router.use(avatarRouter);
router.use(productFeedbackRouter);

export default router;
