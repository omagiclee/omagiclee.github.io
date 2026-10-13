"""Recover camera poses from video frames, using COLMAP on CPU."""
import json
import pathlib
import sys
import numpy as np
import pycolmap

def emit(**value):
    print(json.dumps(value), flush=True)

def main():
    images = pathlib.Path(sys.argv[1])
    output = pathlib.Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    database = output / "database.db"
    sparse = output / "sparse-original"
    sparse.mkdir(exist_ok=True)
    emit(stage="features", progress=.20)
    extraction = pycolmap.FeatureExtractionOptions()
    extraction.num_threads = 4
    extraction.sift.max_num_features = 4096
    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = "SIMPLE_RADIAL"
    pycolmap.extract_features(database, images, camera_mode=pycolmap.CameraMode.SINGLE,
                             reader_options=reader, extraction_options=extraction,
                             device=pycolmap.Device.cpu)
    emit(stage="matching", progress=.28)
    matching = pycolmap.FeatureMatchingOptions()
    matching.num_threads = 4
    pairs = pycolmap.SequentialPairingOptions()
    pairs.overlap = 10
    pairs.loop_detection = False
    pycolmap.match_sequential(database, matching_options=matching, pairing_options=pairs,
                             device=pycolmap.Device.cpu)
    emit(stage="mapping", progress=.37)
    options = pycolmap.IncrementalPipelineOptions()
    options.num_threads = 4
    models = pycolmap.incremental_mapping(database, images, sparse, options=options)
    if not models:
        raise RuntimeError("相机轨迹未能恢复。请沿房间移动拍摄，保留充分重叠，避免运动模糊和纯白墙特写。")
    model = max(models.values(), key=lambda m: m.num_reg_images())
    total = len(list(images.glob("*.jpg")))
    registered = model.num_reg_images()
    if registered < 15 or registered / max(total, 1) < .6:
        raise RuntimeError(f"仅 {registered}/{total} 张图像恢复了相机位置，覆盖不足。请补拍连续且清晰的视角。")
    chosen = output / "chosen-model"
    chosen.mkdir(exist_ok=True)
    model.write(chosen)
    dataset = output / "dataset"
    emit(stage="undistorting", progress=.43, registered=registered, total=total)
    pycolmap.undistort_images(dataset, chosen, images,
                             undistort_options={"max_image_size": 1000}, num_threads=4)
    image = min(model.images.values(), key=lambda i: i.name)
    camera = model.cameras[image.camera_id]
    matrix = image.cam_from_world().inverse().matrix()
    camera_world = np.eye(4)
    camera_world[:3, :] = matrix
    camera_world = camera_world @ np.diag([1., -1., -1., 1.])
    metadata = {"registered": registered, "total": total,
                "points": model.num_points3D(), "reprojectionError": model.compute_mean_reprojection_error(),
                "cameraMatrix": camera_world.T.reshape(-1).tolist(),
                "fov": float(np.degrees(2 * np.arctan(camera.height / (2 * camera.focal_length)))),
                "referenceImage": image.name,
                "metricScaleVerified": False}
    (output / "metadata.json").write_text(json.dumps(metadata))
    emit(stage="poses_ready", progress=.48, metadata=metadata)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit(error=str(error))
        sys.exit(1)
