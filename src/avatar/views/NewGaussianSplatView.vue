<script setup lang="ts">
/**
 * NewGaussianSplatView - 使用分离渲染管道的 GaussianSplat + VRM 场景
 *
 * 特性:
 * 1. VRM 和 GaussianSplat3D 共享同一个 THREE.Scene 和 WebGLRenderer
 * 2. VRM 每帧更新（保持动画流畅）
 * 3. GaussianSplat3D 只在相机移动时更新（减少 GPU 计算）
 * 4. 使用 VrmController 管理 VRM 动画和状态
 *
 * 注意:
 * - GaussianSplats3D 库不支持 WebGPU，必须使用 WebGL 渲染器
 * - 天空球使用自定义 ShaderMaterial 实现渐变效果
 */
import { ref, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { VRMUtils } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation'
import { VRMLookAtSmootherLoaderPlugin } from '@/libs/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmootherLoaderPlugin'
import { Preloader, PreloadResource, PreloaderEvent } from '@/utils/Preloader'
import { VrmController } from '@/utils/VrmController'
// @ts-ignore - GaussianSplats3D doesn't have type definitions
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d'

const main = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const fps = ref(0)
const loadingProgress = ref(0)
const isLoading = ref(true)
const errorMessage = ref('')
const preloadProgress = ref(0)

// VRM 位置控制
const vrmPosition = ref({ x: -1, y: 2.5, z: 8 })
const vrmRotation = ref({ x: 0, y: 0, z: 0 })
const vrmScale = ref(1)

const cameraOffset = 1

// 缓存上一次的 VRM 变换参数，用于检测是否真正改变
let lastVrmPosition = { x: -1, y: 2.5, z: 8 }
let lastVrmRotation = { x: 0, y: 0, z: 0 }
let lastVrmScale = 1

let viewer: any = null
let animationId: number | null = null
let renderer: any = null
let isWebGPU = false
let camera: THREE.PerspectiveCamera | null = null
let scene: THREE.Scene | null = null
let controls: OrbitControls | null = null
let skysphere: THREE.Mesh | null = null
let isPaused = false // 是否暂停渲染

// 背景渲染相关
let backgroundScene: THREE.Scene | null = null // 背景场景（GaussianSplat + 天空球）
let vrmScene: THREE.Scene | null = null // VRM 场景
let backgroundRenderTarget: THREE.WebGLRenderTarget | null = null // 背景渲染目标
let backgroundPlane: THREE.Mesh | null = null // 用于显示背景纹理的平面
let needUpdateBackground = true // 是否需要更新背景
let initialRenderFrames = 0 // 初始渲染帧数计数器
const INITIAL_RENDER_FRAME_COUNT = 60 // 初始强制渲染帧数（约1秒）
let gaussianSplatReady = false // GaussianSplat3D 是否已准备好（从 viewer.viewer.splatRenderReady 同步）

// VRM 引用
let vrmModel: any = null

// VRM 相关
const loader = new GLTFLoader()
loader.crossOrigin = 'anonymous'

// 注册VRMA加载插件
loader.register(parser => {
    return new VRMAnimationLoaderPlugin(parser)
})

// VRM控制器
const vrmController = new VrmController()

// VRM 模型和动画 URL
const modelUrl = '/models/星穹铁道—昔涟.vrm'
const animationUrl = '/animations/shy/waiting.vrma'

// 预加载器
const preloader = new Preloader()
preloader.bindGLTFLoader(loader)

// 监听资源进度
preloader.on(PreloaderEvent.PROGRESS, (progress: any) => {
    preloadProgress.value = progress
})

// 监听资源加载完成
preloader.on(PreloaderEvent.COMPLETED, (resources: any) => {
    console.log('VRM Preload completed', resources)

    const model = resources.getByName('model').data
    const modelVrm = model.userData.vrm
    const idleAnimation = resources.getByName('idle_animation').data.userData.vrmAnimations[0]

    // 优化模型
    VRMUtils.removeUnnecessaryVertices(modelVrm.scene)
    VRMUtils.combineSkeletons(modelVrm.scene)

    // VRM 0.x 用的是左手坐标系,需要旋转
    if (modelVrm.meta.metaVersion == '0') {
        VRMUtils.rotateVRM0(modelVrm)
    }

    console.log('VRM Model loaded', modelVrm)

    // 使用VrmController设置VRM模型
    vrmController.setVRM(modelVrm)

    // 保存VRM引用，用于位置控制
    vrmModel = modelVrm

    // 初始化 VRM 位置（只设置一次）
    vrmModel.scene.position.set(vrmPosition.value.x, vrmPosition.value.y, vrmPosition.value.z)
    vrmModel.scene.rotation.set(
        (vrmRotation.value.x * Math.PI) / 180,
        (vrmRotation.value.y * Math.PI) / 180,
        (vrmRotation.value.z * Math.PI) / 180
    )
    vrmModel.scene.scale.setScalar(vrmScale.value)

    // 注册并播放动画
    vrmController.registerVRMAnimation('idle', idleAnimation)
    vrmController.playAction('idle', {
        loop: true,
        resetSpringBones: false,
    })

    // 添加到场景
    if (vrmScene) {
        vrmScene.add(modelVrm.scene)
    }

    console.log('VRM added to scene')
})

// 添加VRM资源
preloader.add(new PreloadResource(modelUrl, 'model'))
preloader.add(new PreloadResource(animationUrl, 'idle_animation'))

// 创建一个时钟
const clock = new THREE.Clock()
clock.start()

// FPS 计算
let frameCount = 0
let fpsUpdateTime = 0

// 相机移动检测
const cameraState = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
}
const cameraMoveThreshold = 0.001 // 位置阈值
const cameraRotateThreshold = 0.01 // 旋转阈值（弧度）

/**
 * 检测相机是否移动
 */
function hasCameraMoved(): boolean {
    if (!camera) return false

    const positionMoved = camera.position.distanceTo(cameraState.position) > cameraMoveThreshold
    const rotationMoved = camera.quaternion.angleTo(cameraState.quaternion) > cameraRotateThreshold

    if (positionMoved || rotationMoved) {
        // 更新缓存状态
        cameraState.position.copy(camera.position)
        cameraState.quaternion.copy(camera.quaternion)
        needUpdateBackground = true // 标记需要更新背景
        return true
    }

    return false
}

/**
 * 更新 VRM 位置
 */
function updateVRMTransform() {
    if (vrmModel && vrmModel.scene) {
        // 检测 VRM 变换参数是否真正改变
        const positionChanged =
            vrmPosition.value.x !== lastVrmPosition.x ||
            vrmPosition.value.y !== lastVrmPosition.y ||
            vrmPosition.value.z !== lastVrmPosition.z

        const rotationChanged =
            vrmRotation.value.x !== lastVrmRotation.x ||
            vrmRotation.value.y !== lastVrmRotation.y ||
            vrmRotation.value.z !== lastVrmRotation.z

        const scaleChanged = vrmScale.value !== lastVrmScale

        // 只有在变换参数真正改变时才更新
        const hasChanged = positionChanged || rotationChanged || scaleChanged

        if (hasChanged) {
            vrmModel.scene.position.set(
                vrmPosition.value.x,
                vrmPosition.value.y,
                vrmPosition.value.z
            )
            vrmModel.scene.rotation.set(
                (vrmRotation.value.x * Math.PI) / 180,
                (vrmRotation.value.y * Math.PI) / 180,
                (vrmRotation.value.z * Math.PI) / 180
            )
            vrmModel.scene.scale.setScalar(vrmScale.value)

            // 更新 OrbitControls 的旋转中心为 VRM 模型中心（头部/胸部位置）
            if (controls) {
                const vrmCenterY = vrmPosition.value.y + cameraOffset * vrmScale.value // 根据缩放调整
                controls.target.set(vrmPosition.value.x, vrmCenterY, vrmPosition.value.z)
                controls.update()
            }

            // 更新缓存的变换参数
            lastVrmPosition = { ...vrmPosition.value }
            lastVrmRotation = { ...vrmRotation.value }
            lastVrmScale = vrmScale.value

            console.log('VRM transform updated:', {
                position: vrmPosition.value,
                rotation: vrmRotation.value,
                scale: vrmScale.value,
            })
        }
    }
}

/**
 * 动画循环
 */
function animate() {
    animationId = requestAnimationFrame(animate)

    // 如果暂停则不渲染，同时不获取 delta 时间（避免累积）
    if (isPaused) {
        return
    }

    if (renderer && camera && vrmScene && backgroundScene && backgroundRenderTarget) {
        // 只有在渲染时才获取 delta，这样暂停期间不会累积时间
        const delta = clock.getDelta()

        // 更新 FPS（在这里计算整体渲染帧率）
        frameCount++
        fpsUpdateTime += delta
        if (fpsUpdateTime >= 1) {
            fps.value = Math.ceil(frameCount / fpsUpdateTime)
            frameCount = 0
            fpsUpdateTime -= 1 // 保留超出1秒的部分，保持计算连续性
        }

        // 更新控制器
        if (controls) {
            controls.update()
        }

        // 检测相机是否移动
        hasCameraMoved()

        // 同步 GaussianSplat3D 的渲染就绪状态
        if (viewer && viewer.viewer && viewer.viewer.splatRenderReady && !gaussianSplatReady) {
            gaussianSplatReady = true
            console.log('GaussianSplat3D render ready detected!')
        }

        // 初始加载时强制渲染若干帧，确保 GaussianSplat3D 完整显示
        // 只有当 GaussianSplat3D 准备好后才开始计数
        const forceInitialRender =
            gaussianSplatReady && initialRenderFrames < INITIAL_RENDER_FRAME_COUNT
        if (forceInitialRender) {
            initialRenderFrames++
            needUpdateBackground = true
        }

        // 只在相机移动时或初始加载时更新背景（GaussianSplat3D + 天空球）
        if (needUpdateBackground) {
            // 渲染背景场景到 RenderTarget
            renderer.setRenderTarget(backgroundRenderTarget)
            renderer.render(backgroundScene, camera)
            renderer.setRenderTarget(null)

            if (!forceInitialRender) {
                needUpdateBackground = false
            } else if (initialRenderFrames === INITIAL_RENDER_FRAME_COUNT) {
                needUpdateBackground = false
                console.log(
                    `Initial background rendering completed (${INITIAL_RENDER_FRAME_COUNT} frames)`
                )
            }
        }

        // 更新VRM（每帧都更新）
        if (vrmController.hasVRM()) {
            vrmController.update(delta)
            updateVRMTransform()
        }

        // 渲染 VRM 场景（包含背景纹理平面）
        renderer.render(vrmScene, camera)
    }
}

/**
 * 窗口大小变化处理
 */
function onWindowResize() {
    if (camera && renderer && backgroundRenderTarget) {
        camera.aspect = window.innerWidth / window.innerHeight
        camera.updateProjectionMatrix()
        renderer.setSize(window.innerWidth, window.innerHeight)

        // 更新 RenderTarget 尺寸
        backgroundRenderTarget.setSize(
            window.innerWidth * window.devicePixelRatio,
            window.innerHeight * window.devicePixelRatio
        )

        // 标记需要更新背景
        needUpdateBackground = true
    }
}

/**
 * 页面可见性变化处理
 */
function onVisibilityChange() {
    if (document.hidden) {
        isPaused = true
        console.log('Page hidden, rendering paused')
    } else {
        // 页面回到前台，恢复渲染
        isPaused = false
        clock.getDelta()
        needUpdateBackground = true
    }
}

onMounted(async () => {
    try {
        // 1. 创建渲染器
        // 注意: GaussianSplats3D 不支持 WebGPU，必须使用 WebGL 渲染器
        if (!canvas.value) {
            throw new Error('Canvas element not found')
        }

        console.log('Using WebGLRenderer (GaussianSplats3D requires WebGL)')
        renderer = new THREE.WebGLRenderer({
            canvas: canvas.value,
            antialias: true,
        })
        isWebGPU = false

        renderer.setSize(window.innerWidth, window.innerHeight)
        renderer.setPixelRatio(window.devicePixelRatio)

        // 2. 创建 RenderTarget 用于背景渲染
        backgroundRenderTarget = new THREE.WebGLRenderTarget(
            window.innerWidth * window.devicePixelRatio,
            window.innerHeight * window.devicePixelRatio,
            {
                minFilter: THREE.LinearFilter,
                magFilter: THREE.LinearFilter,
                format: THREE.RGBAFormat,
            }
        )

        // 3. 创建背景场景（GaussianSplat + 天空球）
        backgroundScene = new THREE.Scene()

        // 创建天空球（半径调整为80，在远裁剪平面内）
        const skyGeometry = new THREE.SphereGeometry(80, 64, 64)

        // 创建渐变材质的顶点着色器
        const skyVertexShader = `
            varying vec3 vWorldPosition;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldPosition = worldPosition.xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `

        // 创建渐变材质的片段着色器
        const skyFragmentShader = `
            uniform vec3 bottomColor;
            uniform vec3 color1;
            uniform vec3 color2;
            uniform vec3 color3;
            uniform vec3 topColor;
            varying vec3 vWorldPosition;
            
            void main() {
                // 归一化y坐标 (-1 到 1)
                float h = normalize(vWorldPosition).y;
                
                vec3 color;
                
                if (h < -0.2) {
                    // 底部50%: 纯色 5a829b
                    color = bottomColor;
                } else if (h < 0.14) {
                    // 0% - 7%: fff2c5 到 eec6ad
                    float t = h / 0.14;
                    color = mix(color1, color2, t);
                } else if (h < 0.5) {
                    // 7% - 25%: eec6ad 到 8c9f9e
                    float t = (h - 0.14) / 0.36;
                    color = mix(color2, color3, t);
                } else if (h < 1.0) {
                    // 25% - 50%: 8c9f9e 到 53768a
                    float t = (h - 0.5) / 0.5;
                    color = mix(color3, topColor, t);
                } else {
                    color = topColor;
                }
                
                gl_FragColor = vec4(color, 1.0);
            }
        `

        const skyMaterial = new THREE.ShaderMaterial({
            vertexShader: skyVertexShader,
            fragmentShader: skyFragmentShader,
            uniforms: {
                bottomColor: { value: new THREE.Color(0x5a829b) }, // 底部50%
                color1: { value: new THREE.Color(0xf3c5b2) }, // 0-7%起始: fff2c5
                color2: { value: new THREE.Color(0xf6dbb1) }, // 0-7%结束: eec6ad
                color3: { value: new THREE.Color(0x96c9f1) }, // 7-30%结束: 8c9f9e
                topColor: { value: new THREE.Color(0x477cad) }, // 30-50%结束: 53768a
            },
            side: THREE.BackSide, // 从内部看
            depthWrite: false,
        })

        skysphere = new THREE.Mesh(skyGeometry, skyMaterial)
        skysphere.renderOrder = -1 // 最先渲染（背景）
        skysphere.frustumCulled = false
        backgroundScene.add(skysphere)

        console.log('Sky sphere created:', skysphere)

        // 添加环境光到背景场景
        const ambientLight = new THREE.AmbientLight(0xffffff, 4)
        backgroundScene.add(ambientLight)

        // 4. 创建 VRM 场景
        vrmScene = new THREE.Scene()

        // 创建一个全屏平面来显示背景纹理
        const backgroundGeometry = new THREE.PlaneGeometry(2, 2)
        const backgroundMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tBackground: { value: backgroundRenderTarget.texture },
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D tBackground;
                varying vec2 vUv;
                void main() {
                    gl_FragColor = texture2D(tBackground, vUv);
                }
            `,
            depthTest: false,
            depthWrite: false,
        })

        backgroundPlane = new THREE.Mesh(backgroundGeometry, backgroundMaterial)
        backgroundPlane.renderOrder = -1000 // 最先渲染
        backgroundPlane.frustumCulled = false
        vrmScene.add(backgroundPlane)

        // 添加环境光到 VRM 场景
        const vrmAmbientLight = new THREE.AmbientLight(0xffffff, 4)
        vrmScene.add(vrmAmbientLight)

        // 3. 创建相机
        camera = new THREE.PerspectiveCamera(
            30,
            window.innerWidth / window.innerHeight,
            0.1,
            100 // 缩短远裁剪平面，降低渲染距离
        )
        // 设置默认摄像头位置
        camera.position.set(-0.82, 3.6, 11)
        // lookAt 将在 controls 创建后由 controls.target 控制

        // 初始化相机状态缓存
        cameraState.position.copy(camera.position)
        cameraState.quaternion.copy(camera.quaternion)

        // 5. 创建控制器
        controls = new OrbitControls(camera, renderer.domElement)
        // 旋转中心设置为 VRM 模型的头部/胸部位置（Y 轴加上模型高度的一半左右）
        const vrmCenterY = vrmPosition.value.y + cameraOffset // 假设模型高度约 1.5 米，中心在 0.75 米处
        controls.target.set(vrmPosition.value.x, vrmCenterY, vrmPosition.value.z)

        // 锁定相机距离和平移，只允许旋转
        controls.enablePan = false // 禁用平移（右键/中键拖拽）
        controls.enableRotate = true // 启用旋转（左键拖拽）

        // 相机旋转限制
        controls.minPolarAngle = Math.PI * 0.45
        controls.maxPolarAngle = Math.PI * 0.55
        controls.minAzimuthAngle = -Math.PI * 0.5
        controls.maxAzimuthAngle = Math.PI * 0.5

        // 缩放限制
        controls.enableZoom = true
        controls.minDistance = 2.0
        controls.maxDistance = 3.01

        controls.update()

        console.log('Initial camera position:', camera.position)
        console.log('Initial camera rotation:', camera.rotation)
        console.log('Initial camera target:', controls.target)

        // 6. 预先导入VRM相关模块
        const { VRMLoaderPlugin } = await import('@pixiv/three-vrm')

        // 注册VRM加载插件（WebGL模式，使用默认材质）
        loader.register(parser => {
            const options: any = {
                lookAtPlugin: new VRMLookAtSmootherLoaderPlugin(parser),
            }

            return new VRMLoaderPlugin(parser, options)
        })

        // 7. 开始预加载VRM资源
        preloader.load()

        // 8. 使用 DropInViewer 方式创建 GaussianSplats3D Viewer
        viewer = new GaussianSplats3D.DropInViewer({
            sharedMemoryForWorkers: false,
            sphericalHarmonicsDegree: 0,
            // 使用 Always 模式确保初始渲染完整
            // 我们通过只在相机移动时更新 RenderTarget 来控制性能
            renderMode: GaussianSplats3D.RenderMode.Always,
            // 使用 Instant 模式禁用渐进式加载，确保场景立即完整显示
            sceneRevealMode: GaussianSplats3D.SceneRevealMode.Instant,
        })

        // 9. 加载 Gaussian Splat 场景并添加到viewer
        viewer
            .addSplatScenes(
                [
                    {
                        path: '/scenes/aedes_elysiae.splat',
                        splatAlphaRemovalThreshold: 60,
                        scale: [2, 2, 2], // 放大2倍
                        position: [0, 0, 0],
                        onProgress: (progress: number, message: string, type: any) => {
                            loadingProgress.value = progress
                        },
                    },
                ],
                false
            ) // 设置为 false 禁用 GaussianSplats3D 的内置加载UI
            .then(() => {
                console.log('Gaussian Splat scene loaded successfully')

                // 将viewer添加到背景场景中
                if (backgroundScene) {
                    backgroundScene.add(viewer)
                }

                console.log('DropInViewer added to background scene')

                // 设置加载完成状态
                isLoading.value = false
                loadingProgress.value = 100

                // 显示主界面
                if (main.value) {
                    main.value.classList.remove('hide')
                }

                // 初始渲染一次背景
                needUpdateBackground = true

                // 开始动画循环
                animate()
            })
            .catch((error: any) => {
                console.error('Failed to load Gaussian Splat scene:', error)
                isLoading.value = false
                errorMessage.value = `加载失败: ${error.message}`
            })

        // 监听窗口变化
        window.addEventListener('resize', onWindowResize)

        // 监听页面可见性变化
        document.addEventListener('visibilitychange', onVisibilityChange)
    } catch (error: any) {
        console.error('Failed to initialize Gaussian Splat viewer:', error)
        isLoading.value = false
        errorMessage.value = `初始化失败: ${error.message}`
    }
})

onUnmounted(() => {
    // 停止动画
    if (animationId) {
        cancelAnimationFrame(animationId)
        animationId = null
    }

    // 卸载事件
    window.removeEventListener('resize', onWindowResize)
    document.removeEventListener('visibilitychange', onVisibilityChange)

    // 清理VrmController
    if (vrmController) {
        vrmController.clearVRM()
    }

    // 清理VRM引用
    vrmModel = null

    // 清理背景平面
    if (backgroundPlane) {
        if (backgroundPlane.geometry) backgroundPlane.geometry.dispose()
        if (backgroundPlane.material) (backgroundPlane.material as THREE.Material).dispose()
        backgroundPlane = null
    }

    // 清理 RenderTarget
    if (backgroundRenderTarget) {
        backgroundRenderTarget.dispose()
        backgroundRenderTarget = null
    }

    // 清理天空球
    if (skysphere) {
        if (skysphere.geometry) skysphere.geometry.dispose()
        if (skysphere.material) (skysphere.material as THREE.Material).dispose()
        skysphere = null
    }

    // 销毁控制器
    if (controls) {
        controls.dispose()
        controls = null
    }

    // 销毁 viewer
    if (viewer) {
        try {
            viewer.dispose()
        } catch (error) {
            console.error('Error disposing viewer:', error)
        }
        viewer = null
    }

    // 清理场景
    if (backgroundScene) {
        backgroundScene.clear()
        backgroundScene = null
    }

    if (vrmScene) {
        vrmScene.clear()
        vrmScene = null
    }

    // 销毁渲染器
    if (renderer) {
        renderer.dispose()
        if (renderer.forceContextLoss) {
            renderer.forceContextLoss()
        }
        renderer = null
    }

    camera = null
})
</script>

<template>
    <main ref="main" class="hide">
        <canvas ref="canvas"></canvas>
        <span class="fps">FPS: {{ fps }}</span>
        <span class="loading" :class="{ hide: !isLoading }">{{
            `加载高斯场景…(${loadingProgress}%)`
        }}</span>
        <span class="vrm-loading" :class="{ hide: preloadProgress === 100 }">{{
            `加载VRM…(${preloadProgress}%)`
        }}</span>
        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>
    </main>
</template>

<style scoped>
main {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    background-color: #000000;
    overflow: hidden;
}

main.hide {
    opacity: 0;
}

canvas {
    width: 100%;
    height: 100%;
}

.fps {
    position: absolute;
    top: 0;
    left: 0;
    font-size: 42px;
    padding: 0.5rem;
    color: #ffffff;
    background-color: rgba(0, 0, 0, 0.5);
    filter: opacity(1);
}

.loading {
    position: absolute;
    top: 50%;
    left: 50%;
    font-size: 21px;
    text-align: center;
    padding: 0.5rem;
    color: #ffffff;
    background-color: rgba(0, 0, 0, 0.5);
    filter: opacity(1);
    transform: translate(-50%, -50%);
    transition: filter 1s ease 0.5s;
}

.loading.hide {
    filter: opacity(0);
}

.vrm-loading {
    position: absolute;
    top: 60%;
    left: 50%;
    font-size: 21px;
    text-align: center;
    padding: 0.5rem;
    color: #ffffff;
    background-color: rgba(0, 0, 0, 0.5);
    filter: opacity(1);
    transform: translate(-50%, -50%);
    transition: filter 1s ease 0.5s;
}

.vrm-loading.hide {
    filter: opacity(0);
}

.error {
    position: absolute;
    top: 50%;
    left: 50%;
    font-size: 21px;
    text-align: center;
    padding: 1rem;
    color: #ff0000;
    background-color: rgba(0, 0, 0, 0.8);
    border: 2px solid #ff0000;
    border-radius: 8px;
    transform: translate(-50%, -50%);
    max-width: 80%;
    word-wrap: break-word;
}
</style>
