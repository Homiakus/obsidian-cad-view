import sys
import os
import NXOpen
import NXOpen.UF

def safe_print(msg):
    try:
        sys.stdout.buffer.write((str(msg) + "\n").encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()
    except:
        try:
            print(ascii(str(msg)))
        except:
            pass

def main():
    theSession = NXOpen.Session.GetSession()
    ufSession = NXOpen.UF.UFSession.GetUFSession()

    path = r"d:\Programms\obsidian-cad\test-vault\1 часть кондуктора.prt"
    part = theSession.Parts.OpenBaseDisplay(path)
    if isinstance(part, tuple):
        part = part[0]

    safe_print(f"Part opened: {part.Leaf}")
    bodies_list = list(part.Bodies)
    safe_print(f"part.Bodies count: {len(bodies_list)}")
    for i, b in enumerate(bodies_list):
        safe_print(f"  Body {i}: IsSolid={b.IsSolidBody}, IsSheet={b.IsSheetBody}, Name='{b.Name}', Tag={b.Tag}, Layer={b.Layer}")

    # Check work part bodies
    workPart = theSession.Parts.Work
    safe_print(f"workPart: {workPart.Leaf if workPart else 'None'}")
    if workPart:
        safe_print(f"workPart.Bodies count: {len(list(workPart.Bodies))}")
        for i, b in enumerate(workPart.Bodies):
            safe_print(f"  Work Body {i}: IsSolid={b.IsSolidBody}, IsSheet={b.IsSheetBody}, Tag={b.Tag}")

    # Check display part bodies
    dispPart = theSession.Parts.Display
    safe_print(f"dispPart: {dispPart.Leaf if dispPart else 'None'}")
    if dispPart:
        safe_print(f"dispPart.Bodies count: {len(list(dispPart.Bodies))}")
        for i, b in enumerate(dispPart.Bodies):
            safe_print(f"  Display Body {i}: IsSolid={b.IsSolidBody}, IsSheet={b.IsSheetBody}, Tag={b.Tag}")

    # Check UF all bodies in part
    body_type = NXOpen.UF.UFConstants.UF_solid_type
    body_tag = NXOpen.Tag.Null
    count_uf = 0
    while True:
        body_tag = ufSession.Obj.CycleObjsInPart(part.Tag, body_type, body_tag)
        if body_tag == NXOpen.Tag.Null:
            break
        type_and_subtype = ufSession.Obj.AskTypeAndSubtype(body_tag)
        safe_print(f"  UF Object Tag={body_tag}, Subtype={type_and_subtype[1]}")
        count_uf += 1
    safe_print(f"Total UF_solid_type objects: {count_uf}")

    # Check features
    feats = list(part.Features)
    safe_print(f"Features count: {len(feats)}")
    for feat in feats[:15]:
        try:
            safe_print(f"  Feature: {feat.GetFeatureType()} - {feat.GetFeatureName()}")
            bodies = feat.GetBodies()
            safe_print(f"    Bodies from feature: {len(bodies)}")
            for fb in bodies:
                safe_print(f"      Feature body: Tag={fb.Tag}, IsSolid={fb.IsSolidBody}")
        except Exception as fe:
            safe_print(f"    Feature error: {fe}")

    # Check ComponentAssembly
    if part.ComponentAssembly:
        root = part.ComponentAssembly.RootComponent
        safe_print(f"RootComponent: {root.DisplayName if root else 'None'}")
        if root:
            for child in root.GetChildren():
                safe_print(f"  Child Component: {child.DisplayName}, Tag={child.Tag}")
                proto = child.Prototype
                if proto:
                    safe_print(f"    Proto: {proto.Leaf}, Bodies: {len(list(proto.Bodies))}")

if __name__ == "__main__":
    main()
