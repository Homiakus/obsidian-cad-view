# Test journal to check NXOpen environment
import NXOpen
import NXOpen.UF

def main():
    theSession = NXOpen.Session.GetSession()
    ufSession = NXOpen.UF.UFSession.GetUFSession()
    print(f"NXOpen Session initialized. Version: {theSession.GetEnvironmentVariableValue('UGII_VERSION') or '2512'}")

if __name__ == "__main__":
    main()
