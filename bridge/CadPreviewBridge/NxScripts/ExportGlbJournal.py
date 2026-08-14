# NXOpen Journal for exporting Siemens NX PRT, STEP, and JT to Binary GLB & Metadata
# Executed via: run_journal.exe -nx ExportGlbJournal.py -args "<job_json_file>"

import sys
import os
import json
import struct
import math

try:
    import NXOpen
    import NXOpen.Assemblies
    import NXOpen.Facet
    import NXOpen.UF
    NX_AVAILABLE = True
except ImportError:
    NX_AVAILABLE = False

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

def log(msg):
    try:
        sys.stdout.write(f"[NX_JOURNAL] {msg}\n")
        sys.stdout.flush()
    except Exception:
        try:
            sys.stdout.buffer.write(f"[NX_JOURNAL] {msg}\n".encode("utf-8", errors="replace"))
            sys.stdout.buffer.flush()
        except Exception:
            pass

def tessellate_body(body, ufSession, chord_tol, ang_tol):
    positions = []
    normals = []
    indices = []

    body_tag = body.Tag
    try:
        facet_params = ufSession.Facet.AskDefaultParameters()
        facet_params.SurfaceAngularTolerance = ang_tol
        facet_params.SurfaceDistTolerance = chord_tol
        facet_params.SpecifySurfaceTolerance = True
        facet_params.SpecifyParameters = True
        facet_params.SpecifyConvexFacets = True

        model_tag = ufSession.Facet.FacetSolid(body_tag, facet_params)
        num_facets = ufSession.Facet.AskNFacetsInModel(model_tag)

        facet_id = -1
        while True:
            facet_id = ufSession.Facet.CycleFacets(model_tag, facet_id)
            if facet_id == -1:
                break

            num_verts, vertices = ufSession.Facet.AskVerticesOfFacet(model_tag, facet_id)
            num_norms, facet_normals = ufSession.Facet.AskNormalsOfFacet(model_tag, facet_id)

            if num_verts < 3:
                continue

            base_v_idx = len(positions) // 3

            for v in range(num_verts):
                positions.extend([float(vertices[v][0]), float(vertices[v][1]), float(vertices[v][2])])
                if num_norms > v:
                    normals.extend([float(facet_normals[v][0]), float(facet_normals[v][1]), float(facet_normals[v][2])])
                elif num_norms > 0:
                    normals.extend([float(facet_normals[0][0]), float(facet_normals[0][1]), float(facet_normals[0][2])])
                else:
                    normals.extend([0.0, 1.0, 0.0])

            # Triangulate polygon fan (0, v, v+1)
            for v in range(1, num_verts - 1):
                indices.extend([base_v_idx, base_v_idx + v, base_v_idx + v + 1])

        try:
            ufSession.Facet.DeleteAllFacetsFromModel(model_tag)
        except:
            pass

    except Exception as e:
        log(f"Error tessellating body tag {body_tag}: {e}")

    return positions, normals, indices

def write_glb(output_path, meshes_data, materials_data, nodes_data, scene_name="CAD_Model"):
    bin_data = bytearray()
    buffer_views = []
    accessors = []
    gltf_meshes = []
    gltf_materials = []
    gltf_nodes = []

    if not materials_data:
        materials_data = [{
            "name": "Mat_CAD_Default",
            "baseColorFactor": [0.75, 0.78, 0.82, 1.0],
            "metallicFactor": 0.6,
            "roughnessFactor": 0.35
        }]

    for mat in materials_data:
        pbr = {
            "baseColorFactor": mat.get("baseColorFactor", [0.75, 0.78, 0.82, 1.0]),
            "metallicFactor": mat.get("metallicFactor", 0.6),
            "roughnessFactor": mat.get("roughnessFactor", 0.35)
        }
        gltf_mat = {
            "name": mat.get("name", "Material"),
            "pbrMetallicRoughness": pbr,
            "doubleSided": True
        }
        if pbr["baseColorFactor"][3] < 0.999:
            gltf_mat["alphaMode"] = "BLEND"
        gltf_materials.append(gltf_mat)

    for m_idx, mesh in enumerate(meshes_data):
        pos = mesh.get("positions", [])
        norm = mesh.get("normals", [])
        indices = mesh.get("indices", [])
        mat_idx = mesh.get("materialIndex", 0)

        if not pos or not indices:
            continue

        while len(bin_data) % 4 != 0:
            bin_data.append(0)

        pos_offset = len(bin_data)
        min_x = min(pos[0::3])
        max_x = max(pos[0::3])
        min_y = min(pos[1::3])
        max_y = max(pos[1::3])
        min_z = min(pos[2::3])
        max_z = max(pos[2::3])

        pos_bytes = struct.pack(f"<{len(pos)}f", *pos)
        bin_data.extend(pos_bytes)
        pos_len = len(pos_bytes)

        pos_bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": pos_offset,
            "byteLength": pos_len,
            "target": 34962
        })

        pos_acc_idx = len(accessors)
        accessors.append({
            "bufferView": pos_bv_idx,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(pos) // 3,
            "type": "VEC3",
            "min": [min_x, min_y, min_z],
            "max": [max_x, max_y, max_z]
        })

        norm_acc_idx = None
        if norm and len(norm) == len(pos):
            while len(bin_data) % 4 != 0:
                bin_data.append(0)

            norm_offset = len(bin_data)
            norm_bytes = struct.pack(f"<{len(norm)}f", *norm)
            bin_data.extend(norm_bytes)
            norm_len = len(norm_bytes)

            norm_bv_idx = len(buffer_views)
            buffer_views.append({
                "buffer": 0,
                "byteOffset": norm_offset,
                "byteLength": norm_len,
                "target": 34962
            })

            norm_acc_idx = len(accessors)
            accessors.append({
                "bufferView": norm_bv_idx,
                "byteOffset": 0,
                "componentType": 5126,
                "count": len(norm) // 3,
                "type": "VEC3"
            })

        while len(bin_data) % 4 != 0:
            bin_data.append(0)

        idx_offset = len(bin_data)
        max_idx = max(indices) if indices else 0
        use_uint32 = max_idx >= 65535

        if use_uint32:
            idx_bytes = struct.pack(f"<{len(indices)}I", *indices)
            comp_type = 5125
        else:
            idx_bytes = struct.pack(f"<{len(indices)}H", *indices)
            comp_type = 5123

        bin_data.extend(idx_bytes)
        idx_len = len(idx_bytes)

        idx_bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": idx_offset,
            "byteLength": idx_len,
            "target": 34963
        })

        idx_acc_idx = len(accessors)
        accessors.append({
            "bufferView": idx_bv_idx,
            "byteOffset": 0,
            "componentType": comp_type,
            "count": len(indices),
            "type": "SCALAR",
            "min": [0],
            "max": [max_idx]
        })

        attributes = {"POSITION": pos_acc_idx}
        if norm_acc_idx is not None:
            attributes["NORMAL"] = norm_acc_idx

        primitive = {
            "attributes": attributes,
            "indices": idx_acc_idx,
            "material": max(0, min(mat_idx, len(gltf_materials) - 1)),
            "mode": 4
        }

        gltf_meshes.append({
            "name": mesh.get("name", f"Mesh_{m_idx}"),
            "primitives": [primitive]
        })

    root_node_indices = []
    for n_idx, node in enumerate(nodes_data):
        node_dict = {
            "name": node.get("name", f"Node_{n_idx}")
        }
        if "meshIndex" in node and node["meshIndex"] is not None and node["meshIndex"] < len(gltf_meshes):
            node_dict["mesh"] = node["meshIndex"]
        if "matrix" in node and node["matrix"]:
            node_dict["matrix"] = node["matrix"]
        if "children" in node and node["children"]:
            node_dict["children"] = node["children"]
        if "extras" in node:
            node_dict["extras"] = node["extras"]

        gltf_nodes.append(node_dict)
        if node.get("isRoot", False):
            root_node_indices.append(n_idx)

    if not root_node_indices:
        root_node_indices = [0] if gltf_nodes else []

    while len(bin_data) % 4 != 0:
        bin_data.append(0)

    gltf = {
        "asset": {
            "version": "2.0",
            "generator": "Obsidian CAD Preview Bridge (Siemens NX Journal Tessellator)"
        },
        "scenes": [
            {
                "name": scene_name,
                "nodes": root_node_indices
            }
        ],
        "scene": 0,
        "nodes": gltf_nodes,
        "meshes": gltf_meshes,
        "materials": gltf_materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [
            {
                "byteLength": len(bin_data)
            }
        ]
    }

    json_str = json.dumps(gltf, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    json_pad = (4 - (len(json_bytes) % 4)) % 4
    json_chunk_len = len(json_bytes) + json_pad

    bin_pad = (4 - (len(bin_data) % 4)) % 4
    bin_chunk_len = len(bin_data) + bin_pad

    total_len = 12 + 8 + json_chunk_len + 8 + bin_chunk_len

    out_dir = os.path.dirname(os.path.abspath(output_path))
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    with open(output_path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total_len))
        f.write(struct.pack("<I4s", json_chunk_len, b"JSON"))
        f.write(json_bytes)
        if json_pad > 0:
            f.write(b" " * json_pad)
        f.write(struct.pack("<I4s", bin_chunk_len, b"BIN\x00"))
        f.write(bin_data)
        if bin_pad > 0:
            f.write(b"\x00" * bin_pad)

def main():
    if len(sys.argv) < 2:
        log("Error: No job parameter file specified.")
        sys.exit(1)

    job_file = sys.argv[1]
    if not os.path.exists(job_file):
        log(f"Error: Job file not found: {job_file}")
        sys.exit(1)

    with open(job_file, "r", encoding="utf-8") as f:
        job = json.load(f)

    source = job.get("source", "")
    output = job.get("output", "")
    quality = job.get("quality", "normal")

    if not NX_AVAILABLE:
        log("NXOpen module not available in this Python interpreter.")
        sys.exit(2)

    theSession = NXOpen.Session.GetSession()
    ufSession = NXOpen.UF.UFSession.GetUFSession()

    ext = os.path.splitext(source)[1].lower()
    log(f"Opening CAD part: {source} (Format: {ext})...")

    def open_cad_part(file_path):
        try:
            res = theSession.Parts.OpenBaseDisplay(file_path)
            if isinstance(res, tuple):
                return res[0]
            return res
        except TypeError:
            try:
                pls = NXOpen.PartLoadStatus()
                res = theSession.Parts.OpenBaseDisplay(file_path, pls)
                if isinstance(res, tuple):
                    return res[0]
                return res
            except Exception:
                return theSession.Parts.Open(file_path)
        except Exception:
            return theSession.Parts.Open(file_path)

    basePart = None
    temp_prt = None
    try:
        if ext == ".prt":
            basePart = open_cad_part(source)
        elif ext in [".step", ".stp"]:
            stepImporter = theSession.DexManager.CreateStep214Importer()
            stepImporter.InputFile = source
            temp_prt = output.replace(".glb", "_temp_import.prt")
            stepImporter.OutputFile = temp_prt
            stepImporter.FileOpenFlag = False
            stepImporter.Commit()
            stepImporter.Destroy()

            basePart = open_cad_part(temp_prt)
        elif ext == ".jt":
            basePart = open_cad_part(source)

        if basePart is None:
            log(f"Failed to load CAD file into NX session: {source}")
            sys.exit(3)

        # Quality settings for tessellation
        chord_tol = 0.05
        ang_tol = 0.25
        if quality == "draft":
            chord_tol = 0.15
            ang_tol = 0.5
        elif quality == "high":
            chord_tol = 0.01
            ang_tol = 0.1
        elif quality == "ultra":
            chord_tol = 0.003
            ang_tol = 0.05

        meshes_data = []
        materials_data = []
        nodes_data = []
        mat_cache = {}

        def get_or_create_material(color_rgb=None, name="Mat_Part"):
            if color_rgb is None:
                color_rgb = (0.75, 0.78, 0.82, 1.0)
            key = tuple(round(c, 3) for c in color_rgb)
            if key in mat_cache:
                return mat_cache[key]
            idx = len(materials_data)
            materials_data.append({
                "name": f"{name}_{idx}",
                "baseColorFactor": list(color_rgb),
                "metallicFactor": 0.65,
                "roughnessFactor": 0.3
            })
            mat_cache[key] = idx
            return idx

        processed_body_tags = set()
        all_positions_for_bbox = []

        def process_body(body, transform_matrix=None, node_name=None):
            if not body.IsSolidBody and not body.IsSheetBody:
                return None
            if body.Tag in processed_body_tags:
                return None
            processed_body_tags.add(body.Tag)

            pos, norm, idx = tessellate_body(body, ufSession, chord_tol, ang_tol)
            if not pos or not idx:
                return None

            all_positions_for_bbox.extend(pos)

            body_color = None
            try:
                color_tag = body.Color
                if color_tag > 0:
                    rgb = ufSession.Disp.AskColor(color_tag, NXOpen.UF.UFDisp.RGB)
                    body_color = (float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0)
            except:
                pass

            mat_idx = get_or_create_material(body_color, "Mat_Body")
            mesh_name = node_name or body.Name or f"Body_{len(meshes_data)+1}"
            mesh_idx = len(meshes_data)
            meshes_data.append({
                "name": mesh_name,
                "positions": pos,
                "normals": norm,
                "indices": idx,
                "materialIndex": mat_idx
            })

            node_idx = len(nodes_data)
            node_dict = {
                "name": mesh_name,
                "meshIndex": mesh_idx,
                "isRoot": False,
                "extras": {
                    "id": f"body_{node_idx}",
                    "type": "body",
                    "visible": True
                }
            }
            if transform_matrix:
                node_dict["matrix"] = transform_matrix
            nodes_data.append(node_dict)
            return node_idx

        root_children = []
        has_components = False

        try:
            if basePart.ComponentAssembly and basePart.ComponentAssembly.RootComponent:
                root_comp = basePart.ComponentAssembly.RootComponent
                def traverse_components(comp):
                    nonlocal has_components
                    comp_children = []
                    for child_comp in comp.GetChildren():
                        has_components = True
                        gl_matrix = None
                        try:
                            matrix_data = child_comp.GetOrientation()
                            pos_data = child_comp.GetPosition()
                            m = matrix_data.Element
                            gl_matrix = [
                                float(m[0,0]), float(m[1,0]), float(m[2,0]), 0.0,
                                float(m[0,1]), float(m[1,1]), float(m[2,1]), 0.0,
                                float(m[0,2]), float(m[1,2]), float(m[2,2]), 0.0,
                                float(pos_data.X), float(pos_data.Y), float(pos_data.Z), 1.0
                            ]
                        except:
                            gl_matrix = None

                        sub_body_nodes = []
                        try:
                            proto = child_comp.Prototype
                            if proto and hasattr(proto, "Bodies"):
                                for b in proto.Bodies:
                                    b_node = process_body(b, None, child_comp.DisplayName or child_comp.Name)
                                    if b_node is not None:
                                        sub_body_nodes.append(b_node)
                        except:
                            pass

                        sub_comp_nodes = traverse_components(child_comp)

                        comp_node_idx = len(nodes_data)
                        nodes_data.append({
                            "name": child_comp.DisplayName or child_comp.Name or f"Component_{comp_node_idx}",
                            "isRoot": False,
                            "children": sub_body_nodes + sub_comp_nodes,
                            "matrix": gl_matrix,
                            "extras": {
                                "id": f"comp_{comp_node_idx}",
                                "type": "component",
                                "visible": True
                            }
                        })
                        comp_children.append(comp_node_idx)
                    return comp_children

                root_children.extend(traverse_components(root_comp))
        except Exception as comp_err:
            log(f"Component traversal note: {comp_err}")

        # Extract root bodies
        for b in basePart.Bodies:
            b_node = process_body(b, None, b.Name or f"Body_{len(root_children)+1}")
            if b_node is not None:
                root_children.append(b_node)

        # Root node
        root_node_idx = len(nodes_data)
        scene_title = os.path.splitext(os.path.basename(source))[0]
        nodes_data.append({
            "name": scene_title,
            "isRoot": True,
            "children": root_children,
            "extras": {
                "id": "root",
                "type": "assembly" if has_components else "body",
                "visible": True
            }
        })

        # Calculate bounding box
        min_x = min_y = min_z = 0.0
        max_x = max_y = max_z = 0.0
        if all_positions_for_bbox:
            min_x = min(all_positions_for_bbox[0::3])
            max_x = max(all_positions_for_bbox[0::3])
            min_y = min(all_positions_for_bbox[1::3])
            max_y = max(all_positions_for_bbox[1::3])
            min_z = min(all_positions_for_bbox[2::3])
            max_z = max(all_positions_for_bbox[2::3])

        total_triangles = sum(len(m["indices"]) // 3 for m in meshes_data)
        log(f"Extracted {len(meshes_data)} meshes with {total_triangles} triangles.")

        # Write GLB
        write_glb(output, meshes_data, materials_data, nodes_data, scene_title)
        log(f"GLB model exported successfully to: {output}")

        # Write Metadata
        meta_file = os.path.splitext(output)[0] + ".metadata.json"
        meta = {
            "source": os.path.basename(source),
            "format": ext.strip("."),
            "units": "mm",
            "bodyCount": len(meshes_data),
            "triangleCount": total_triangles,
            "boundingBox": {
                "min": [round(min_x, 2), round(min_y, 2), round(min_z, 2)],
                "max": [round(max_x, 2), round(max_y, 2), round(max_z, 2)],
                "size": [round(max_x - min_x, 2), round(max_y - min_y, 2), round(max_z - min_z, 2)]
            }
        }
        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

        log("Metadata exported successfully.")

    except Exception as e:
        log(f"Exception during NX conversion: {str(e)}")
        sys.exit(4)
    finally:
        if basePart is not None:
            try:
                theSession.Parts.CloseAll(NXOpen.BasePart.CloseModified.CloseModified, None)
            except:
                pass
        if temp_prt is not None and os.path.exists(temp_prt):
            try:
                os.remove(temp_prt)
            except:
                pass

if __name__ == "__main__":
    main()
